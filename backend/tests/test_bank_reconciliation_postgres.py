"""Bank reconciliation (Doc 03 FR-134; Doc 10 E14 R3): any bank's CSV, its columns mapped once and remembered; lines
matched to ledger entries of the same amount, transfers waiting for confirmation confirmed from the statement, the
rest recorded on the spot (bank charges, other income) or explained; overlapping statements import each line once."""
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting import bank
from cacu.accounting.bank import Explain, Layout, Match, Record, StatementImport, StatementPreview
from cacu.accounting.workflows import ExpenseCreate, bank_accounts, expense_create, sale_create
from test_corrections_postgres import live, call, balance, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_activation_postgres import TODAY
from test_pos_checkout_postgres import sale

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
D, Y = TODAY.strftime('%d/%m/%Y'), (TODAY - timedelta(days=1)).strftime('%d/%m/%Y')


def statement(*extra):
    """A statement as Nigerian banks export it: account details above the table, debit and credit columns."""
    rows = ['Account Name,Ada Provisions', 'Account Number,0123456789', ',', 'Trans. Date,Value Date,Narration,Debit,Credit,Balance',
            f'{D},{D},TRANSFER FROM BISI ADE,,"1,500.00",401500.00', f'{D},{D},SMS ALERT CHARGES,4.00,,401496.00',
            f'{D},{D},ELECTRONIC MONEY TRANSFER LEVY,50.00,,401446.00', f'{D},{D},INTEREST ON DEPOSIT,,"3,000.00",404446.00',
            f'{D},{D},CHEQUE DEPOSIT RETURNED,,999.00,405445.00', f'{Y},{Y},BEFORE THE BOOKS,,10.00,', *extra, 'TOTAL,,,,,']
    return '\n'.join(rows) + '\n'


def account(live):
    return call(live, 'owner', lambda s, a: bank_accounts(s))[0]['id']


def lines(live, acct):
    view = call(live, 'owner', lambda s, a: bank.overview(s, acct, TODAY.strftime('%Y-%m')))
    return view, {l['description']: l for l in view['lines']}


def test_a_statement_is_read_from_any_layout_and_each_line_imported_once(live):
    acct = account(live)
    guessed = call(live, 'owner', lambda s, a: bank.preview(s, StatementPreview(account_id=acct, csv=statement())))
    assert guessed['layout'] == {'header_row': 3, 'date': 0, 'description': 2, 'money_out': 3, 'money_in': 4, 'balance': 5, 'date_order': 'DMY'}
    assert not guessed['remembered'] and guessed['rows'][3][2] == 'Narration'
    layout = Layout(**guessed['layout'])
    first = call(live, 'owner', lambda s, a: bank.import_statement(s, a, StatementImport(request_key=uuid4(), account_id=acct, file_name='nov.csv', csv=statement(), layout=layout)))
    assert first == {'statement_id': first['statement_id'], 'lines': 5, 'already_imported': 0, 'before_books': 1}
    with pytest.raises(HTTPException, match='already been imported'):
        call(live, 'owner', lambda s, a: bank.import_statement(s, a, StatementImport(request_key=uuid4(), account_id=acct, file_name='again.csv', csv=statement(), layout=layout)))
    overlap = call(live, 'owner', lambda s, a: bank.import_statement(s, a, StatementImport(request_key=uuid4(), account_id=acct, file_name='later.csv',
                   csv=statement(f'{D},{D},POS SETTLEMENT,,250.00,405695.00'), layout=layout)))
    assert (overlap['lines'], overlap['already_imported']) == (1, 5)  # only the new line
    assert call(live, 'owner', lambda s, a: bank.preview(s, StatementPreview(account_id=acct, csv=statement())))['remembered']
    view, by = lines(live, acct)
    assert by['SMS ALERT CHARGES']['amount'] == '-4.00' and by['TRANSFER FROM BISI ADE']['amount'] == '1500.00'
    assert by['INTEREST ON DEPOSIT']['balance'] == '404446.00' and view['statement_balance'] == '405695.00'
    with pytest.raises(HTTPException, match='not a date in the order'):
        call(live, 'owner', lambda s, a: bank.import_statement(s, a, StatementImport(request_key=uuid4(), account_id=acct, file_name='x.csv',
             csv=statement(f'{D},{D},ANOTHER FILE,,1.00,'), layout=layout.model_copy(update={'date_order': 'YMD'}))))
    with pytest.raises(HTTPException, match='bank accounts'):
        call(live, 'owner', lambda s, a: bank.preview(s, StatementPreview(account_id=uuid4(), csv=statement())))
    assert bank.parse_amount('(1,234.50)') == Decimal('-1234.50') and bank.parse_amount('₦2,000 CR') == Decimal('2000.00') and bank.parse_amount('75.00DR') == Decimal('-75.00')


def test_lines_are_matched_confirmed_recorded_or_explained_until_the_month_reconciles(live):
    acct = account(live)
    layout = Layout(header_row=3, date=0, description=2, money_out=3, money_in=4, balance=5)
    call(live, 'owner', lambda s, a: bank.import_statement(s, a, StatementImport(request_key=uuid4(), account_id=acct, file_name='nov.csv', csv=statement(), layout=layout)))
    # Recorded in CACU before the statement came: a transfer sale still waiting, and the levy paid from the bank.
    waiting = call(live, 'owner', lambda s, a: sale_create(s, a, sale(live, 'Transfer', (('Beans', 1, '0'),))))
    call(live, 'owner', lambda s, a: expense_create(s, a, ExpenseCreate(request_key=uuid4(), expense_account_id=live.codes['6400'], amount='50.00',
         entry_date=TODAY, method='Transfer', bank_account_id=acct, description='Transfer levy')))
    view, by = lines(live, acct)
    assert view['summary'] == {'lines': 5, 'unmatched': 5, 'unpresented': 1, 'reconciled': False}  # the levy expense; the opening balance is not a movement
    levy = by['ELECTRONIC MONEY TRANSFER LEVY']
    assert [s['kind'] for s in levy['suggestions']] == ['entry'] and levy['suggestions'][0]['amount'] == '-50.00'
    transfer = by['TRANSFER FROM BISI ADE']
    assert [s['kind'] for s in transfer['suggestions']] == ['transfer'] and transfer['suggestions'][0]['transfer_id'] == waiting['saleId']

    with pytest.raises(HTTPException, match='same amount'):
        call(live, 'owner', lambda s, a: bank.match(s, a, Match(line_id=by['SMS ALERT CHARGES']['id'], transaction_id=levy['suggestions'][0]['transaction_id'])))
    call(live, 'owner', lambda s, a: bank.match(s, a, Match(line_id=levy['id'], transaction_id=levy['suggestions'][0]['transaction_id'])))
    call(live, 'owner', lambda s, a: bank.match(s, a, Match(line_id=transfer['id'], transfer_id=waiting['saleId'])))  # the money arrived
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT status FROM accounting.pending_transfer WHERE id=%s', (waiting['saleId'],)).fetchone()[0] == 'confirmed'
    charges = balance(live, '6400')
    call(live, 'owner', lambda s, a: bank.record(s, a, by['SMS ALERT CHARGES']['id'], Record(request_key=uuid4(), kind='expense')))  # bank charges
    assert balance(live, '6400') - charges == Decimal('4.00')
    with pytest.raises(HTTPException, match='recorded as income'):
        call(live, 'owner', lambda s, a: bank.record(s, a, by['INTEREST ON DEPOSIT']['id'], Record(request_key=uuid4(), kind='expense')))
    call(live, 'owner', lambda s, a: bank.record(s, a, by['INTEREST ON DEPOSIT']['id'], Record(request_key=uuid4(), kind='income')))  # other income
    assert balance(live, '4900') == Decimal('-3000.00')
    call(live, 'owner', lambda s, a: bank.explain(s, a, by['CHEQUE DEPOSIT RETURNED']['id'], Explain(note='Cheque bounced; reversed by the bank next month')))

    view, by = lines(live, acct)
    assert view['summary'] == {'lines': 5, 'unmatched': 0, 'unpresented': 0, 'reconciled': True}
    assert by['SMS ALERT CHARGES']['matched_to'] and by['CHEQUE DEPOSIT RETURNED']['status'] == 'explained'
    with pytest.raises(HTTPException, match='already matched or explained'):
        call(live, 'owner', lambda s, a: bank.explain(s, a, by['SMS ALERT CHARGES']['id'], Explain(note='Changed my mind')))
    call(live, 'owner', lambda s, a: bank.undo(s, a, by['SMS ALERT CHARGES']['id']))  # undo puts the line back, the entry stays
    view, by = lines(live, acct)
    assert view['summary']['unmatched'] == 1 and view['summary']['unpresented'] == 1
    assert [s['kind'] for s in by['SMS ALERT CHARGES']['suggestions']] == ['entry']  # and it can be matched again
