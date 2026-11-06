"""Doc 09 / Doc 19 minimum financial tests before an accounting release (gate G2), on a business turned on from an
approved opening position. TEST-103, TEST-104 and TEST-106 live with the engine and workflow tests; see
docs/suite/release-gate-tests-20261101.md for the full map. TEST-107 covers transfer clearing (BL-024)."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, time
from decimal import Decimal
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.catalog import CatalogMutation, catalog_mutate
from cacu.accounting.posting import PostingCommand, post_command
from cacu.accounting.workflows import (InvoiceCreate, ReceiptCreate, SaleCreate, ReversalCreate, expense_create, invoice_create,
                                       receipt_create, reversal_create, sale_create)
from cacu.accounting.bills import BillCreate, SupplierPaymentCreate, bill_create, list_bills, payment_create
from cacu.accounting.stock import request_adjustment
from cacu.accounting.reports import cash_flow, statements, trial_balance
from cacu.accounting.transfers import TransferConfirm, TransferNotReceived, confirm, not_received, daily, list_transfers
from test_corrections_postgres import live, call, balance, expense, adjustment, stock, URL
from test_opening_position_postgres import books
from test_default_chart_postgres import charted
from test_legacy_write_boundary_postgres import boundary
from test_management_postgres import managed, database
from test_library_postgres import database as engine_database, command, post, DSN
from test_activation_postgres import TODAY

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


def ledger_count(live, code):
    with psycopg.connect(URL) as c:
        return c.execute("""SELECT count(*) FROM accounting.ledger l JOIN accounting.account_map m ON m.library_id=l.post_account_id AND m.business_id=l.business_id
            JOIN accounts a ON a.id=m.account_id WHERE l.business_id=%s AND a.code=%s""", (live.business, code)).fetchone()[0]


def test_102_credit_sale_of_100000_with_a_40000_receipt(live):
    item = call(live, 'owner', lambda s, a: catalog_mutate(s, a, CatalogMutation(request_key=uuid4(), operation='item.save', details={
        'name': 'Generator', 'unit_price': '100000', 'cost_price': '60000', 'opening_quantity': 1, 'opening_date': TODAY.isoformat()})))
    before = {code: balance(live, code) for code in ('1000', '1100', '4000', '5000')}
    cogs_entries = ledger_count(live, '5000')
    sale = InvoiceCreate(request_key=uuid4(), customer_id=live.ids['ada'], invoice_number='INV-102', entry_date=TODAY,
                         items=[{'catalog_item_id': item['id'], 'quantity': 1, 'unit_price': '100000'}])
    call(live, 'owner', lambda s, a: invoice_create(s, a, sale))
    receipt = call(live, 'owner', lambda s, a: receipt_create(s, a, ReceiptCreate(request_key=uuid4(), invoice_id=sale.request_key, amount='40000',
                                                                                    entry_date=TODAY, method='Cash')))
    assert receipt['outstanding'] == '60000.00'
    assert -(balance(live, '4000') - before['4000']) == Decimal('100000')  # revenue, recognised once on the invoice
    assert balance(live, '1000') - before['1000'] == Decimal('40000')
    assert balance(live, '1100') - before['1100'] == Decimal('60000')
    assert balance(live, '5000') - before['5000'] == Decimal('60000') and ledger_count(live, '5000') == cogs_entries + 1  # cost of sales once
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT stock_quantity FROM catalog_items WHERE id=%s', (item['id'],)).fetchone() == (0,)
        assert c.execute('SELECT sum(quantity) FROM accounting.stock_event WHERE item_id=%s', (item['id'],)).fetchone() == (0,)


def test_105_fifty_concurrent_sales_of_the_last_ten_units(live):
    def sell(_):
        data = SaleCreate(request_key=uuid4(), items=[{'item_id': live.items['Rice'], 'quantity': 1}], entry_date=TODAY, method='Cash', quoted_total='65000')
        try:
            call(live, 'owner', lambda s, a: sale_create(s, a, data))
            return 'sold'
        except HTTPException as error:
            return error.status_code
    with ThreadPoolExecutor(max_workers=10) as pool:
        outcomes = list(pool.map(sell, range(50)))
    assert outcomes.count('sold') == 10 and outcomes.count(409) == 40
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT stock_quantity FROM catalog_items WHERE id=%s', (live.items['Rice'],)).fetchone() == (0,)
        assert c.execute("SELECT count(*) FROM accounting.document_map WHERE business_id=%s AND source_type='pos'", (live.business,)).fetchone() == (10,)
    assert balance(live, '1000') == Decimal('25000') + 10 * Decimal('65000')


def test_108_postings_in_a_closed_period_are_refused_with_the_reason(live):
    with psycopg.connect(URL) as c:
        c.execute("UPDATE accounting.reporting_period SET status='CLOSED' WHERE entity_id=%s AND calendar_year=%s", (live.entity, TODAY.year))
    with pytest.raises(Exception, match='(?i)closed'):
        call(live, 'owner', lambda s, a: expense_create(s, a, expense(live)))
    with pytest.raises(HTTPException, match='closed accounting period'):
        call(live, 'owner', lambda s, a: request_adjustment(s, a, adjustment(live, -1)))
    assert balance(live, '6200') == 0 and balance(live, '1000') == Decimal('25000')


def test_109_a_month_of_mixed_activity_reconciles(live):
    owner = lambda work: call(live, 'owner', work)
    credit = InvoiceCreate(request_key=uuid4(), customer_id=live.ids['ada'], invoice_number='INV-109', entry_date=TODAY,
                           items=[{'catalog_item_id': live.items['Rice'], 'quantity': 2, 'unit_price': '65000'}])
    owner(lambda s, a: invoice_create(s, a, credit))
    owner(lambda s, a: receipt_create(s, a, ReceiptCreate(request_key=uuid4(), invoice_id=credit.request_key, amount='50000', entry_date=TODAY,
                                                          method='Transfer', bank_account_id=live.ids['bank'])))
    owner(lambda s, a: sale_create(s, a, SaleCreate(request_key=uuid4(), items=[{'item_id': live.items['Beans'], 'quantity': 1}],
                                                    entry_date=TODAY, method='Cash', quoted_total='1500')))
    diesel = expense(live)
    owner(lambda s, a: expense_create(s, a, diesel))
    owner(lambda s, a: expense_create(s, a, expense(live, '6100', '20000', 'Transfer', bank_account_id=live.ids['bank'])))
    owner(lambda s, a: reversal_create(s, a, diesel.request_key, ReversalCreate(request_key=uuid4(), entry_date=TODAY, reason='Duplicate')))
    rent = BillCreate(request_key=uuid4(), supplier_id=live.ids['supplier'], bill_number='MILLS-77', entry_date=TODAY,
                      lines=[{'account_id': live.codes['6600'], 'amount': '30000'}])
    owner(lambda s, a: bill_create(s, a, rent))
    owner(lambda s, a: payment_create(s, a, rent.request_key, SupplierPaymentCreate(request_key=uuid4(), amount='10000', entry_date=TODAY, method='Cash')))
    opening = next(b['id'] for b in owner(lambda s, a: list_bills(s)) if b['opening'])
    owner(lambda s, a: payment_create(s, a, opening, SupplierPaymentCreate(request_key=uuid4(), amount='50000', entry_date=TODAY, method='Transfer',
                                                                           bank_account_id=live.ids['bank'])))
    owner(lambda s, a: request_adjustment(s, a, adjustment(live, -1, 'Beans', 'Broken bag')))

    tb = call(live, 'viewer', lambda s, a: trial_balance(s, TODAY))
    assert tb['controls_checked'] and tb['exceptions'] == [] and tb['difference'] == '0.00'  # receivables, payables and stock agree
    flow = call(live, 'viewer', lambda s, a: cash_flow(s, TODAY, TODAY))
    assert flow['reconciled'] and flow['difference'] == '0.00' and flow['closing_cash'] == flow['ledger_cash']
    report = call(live, 'viewer', lambda s, a: statements(s, TODAY, TODAY))
    assert report['exceptions'] == [] and report['financial_position']['difference'] == ['0.00']


@pytest.mark.parametrize('role', ['cacu_runtime', 'authenticated', 'anon', 'service_role', None])
def test_110_posted_ledger_rows_cannot_be_changed_or_deleted_by_any_role(engine_database, role):
    d = engine_database
    post(d, command(d, 'adjustment', 'equity', 'cash', '1000'))
    for statement in ('UPDATE accounting.ledger SET amount=amount+1', 'DELETE FROM accounting.ledger'):
        with psycopg.connect(DSN) as c:
            if role:
                c.execute(f'SET LOCAL ROLE {role}')
            if role == 'cacu_runtime':  # in the business's scope, so the rows are visible and the immutability trigger must refuse
                c.execute("SELECT set_config('request.jwt.claims',%s,true),set_config('cacu.business_id',%s,true)",
                          (f'{{"sub":"{d[2]}"}}', str(d[1])))
                assert c.execute('SELECT count(*) FROM accounting.ledger').fetchone() == (2,)
            with pytest.raises(psycopg.Error):
                c.execute(statement)
    with psycopg.connect(DSN) as c:
        assert c.execute("SELECT count(*), sum(amount) FILTER (WHERE entry_type::text='DEBIT') FROM accounting.ledger").fetchone() == (2, Decimal('1000'))


def test_107_transfer_sale_confirmation_and_unconfirmed_transfer_reversed(live):
    """BR-010, PR-03 to PR-05: revenue and stock at checkout; money banked only when confirmed; a transfer that never
    arrives reverses the sale and returns its stock at the cost it left at."""
    owner = lambda work: call(live, 'owner', work)
    start = {code: balance(live, code) for code in ('1000', '1010', '1020', '4000', '5000', '1200')}
    on_hand = stock(live, 'Rice')[0]
    sales = []
    for _ in range(2):
        sale = SaleCreate(request_key=uuid4(), items=[{'item_id': live.items['Rice'], 'quantity': 1}], entry_date=TODAY, method='Transfer', quoted_total='65000')
        assert owner(lambda s, a: sale_create(s, a, sale))['status'] == 'pending_payment'
        sales.append(sale.request_key)
    cost = balance(live, '5000') - start['5000']
    assert balance(live, '1020') - start['1020'] == Decimal('130000') and balance(live, '1010') == start['1010']
    assert -(balance(live, '4000') - start['4000']) == Decimal('130000') and stock(live, 'Rice')[0] == on_hand - 2
    waiting = owner(lambda s, a: daily(s, TODAY))
    assert waiting['by_method']['transfer'] == {'sales': 2, 'total': '130000.00', 'awaiting': '130000.00', 'reversed': '0.00'}
    assert waiting['pending_total'] == '130000.00' and [p['age_days'] for p in waiting['pending']] == [0, 0]

    owner(lambda s, a: confirm(s, a, sales[0], TransferConfirm(request_key=uuid4(), bank_account_id=live.ids['bank'])))
    gone = owner(lambda s, a: not_received(s, a, sales[1], TransferNotReceived(request_key=uuid4(), note='Customer reversed the transfer')))
    assert Decimal(gone['stock_cost_restored']) == cost / 2

    assert balance(live, '1010') - start['1010'] == Decimal('65000') and balance(live, '1020') == start['1020']  # nothing left waiting
    assert -(balance(live, '4000') - start['4000']) == Decimal('65000')  # one sale's revenue
    assert balance(live, '5000') - start['5000'] == cost / 2 and stock(live, 'Rice')[0] == on_hand - 1  # the other's stock came back
    assert balance(live, '1200') - start['1200'] == -cost / 2
    with psycopg.connect(URL) as c:
        assert dict(c.execute('SELECT id,status FROM transactions WHERE id = ANY(%s)', (sales,)).fetchall()) == {sales[0]: 'completed', sales[1]: 'reversed'}
    assert owner(lambda s, a: list_transfers(s, 'pending')) == []
    with pytest.raises(HTTPException) as again:
        owner(lambda s, a: not_received(s, a, sales[0], TransferNotReceived(request_key=uuid4(), note='Changed my mind')))
    assert again.value.status_code == 409
    with pytest.raises(HTTPException) as generic:  # only the reconciliation workflow posts these
        owner(lambda s, a: post_command(s, a, PostingCommand(request_key=uuid4(), kind='transfer_confirmation', source_id=uuid4(),
              main_account_id=live.ids['bank'], entry_date=TODAY, narration='Sneaky', credited=False,
              lines=[{'account_id': live.codes['1020'], 'amount': '1.00', 'credited': True}])))
    assert generic.value.status_code == 422

    tb = call(live, 'viewer', lambda s, a: trial_balance(s, TODAY))
    assert tb['controls_checked'] and tb['exceptions'] == [] and tb['difference'] == '0.00'
    flow = call(live, 'viewer', lambda s, a: cash_flow(s, TODAY, TODAY))
    assert flow['reconciled'] and flow['difference'] == '0.00'
