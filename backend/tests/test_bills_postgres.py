"""Supplier bills and payments (PR-18, PR-19) and customers or suppliers added after the books went live."""
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.bills import BillCreate, SupplierPaymentCreate, bill_create, list_bills, payment_create
from cacu.accounting.workflows import InvoiceCreate, invoice_create
from cacu.accounting.reports import trial_balance
from test_corrections_postgres import live, call, balance, URL
from test_opening_position_postgres import books
from test_default_chart_postgres import charted
from test_legacy_write_boundary_postgres import boundary
from test_management_postgres import managed, database
from test_activation_postgres import TODAY

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


def new_party(live, table, name, business=None):
    party = uuid4()
    with psycopg.connect(URL) as c:
        c.execute(f'INSERT INTO {table}(id,business_id,name) VALUES(%s,%s,%s)', (party, business or live.business, name))
    return party


def bill(live, supplier, number='INV-0042', lines=None, **kw):
    lines = lines or [{'account_id': live.codes['6100'], 'amount': '120000'}, {'account_id': live.codes['6600'], 'amount': '5000', 'description': 'Door lock'}]
    return BillCreate(request_key=uuid4(), supplier_id=supplier, bill_number=number, entry_date=TODAY, lines=lines, **kw)


def pay(amount, method='Transfer', **kw):
    if method == 'Transfer':
        kw.setdefault('bank_account_id', None)
    return SupplierPaymentCreate(request_key=uuid4(), amount=amount, entry_date=TODAY, method=method, **kw)


def mapped(live, kind, party):
    with psycopg.connect(URL) as c:
        return c.execute('SELECT count(*) FROM accounting.party_map WHERE business_id=%s AND party_type=%s AND party_id=%s', (live.business, kind, party)).fetchone()[0]


def test_opening_bill_is_listed_and_paid_off_in_parts(live):
    listed = call(live, 'viewer', lambda s, a: list_bills(s))
    assert [(b['supplier_name'], b['bill_number'], b['total'], b['outstanding'], b['status'], b['opening']) for b in listed] == \
        [('Mills Ltd', 'Opening balance', '150000.50', '150000.50', 'unpaid', True)]
    opening = listed[0]['id']
    first = pay('50000.50', bank_account_id=live.ids['bank'])
    result = call(live, 'editor', lambda s, a: payment_create(s, a, opening, first))
    assert result['posting']['outstanding'] == '100000.00'
    assert call(live, 'editor', lambda s, a: payment_create(s, a, opening, first)) == result  # a retry replays
    assert call(live, 'viewer', lambda s, a: list_bills(s))[0]['status'] == 'part_paid'
    with pytest.raises(HTTPException, match='exceeds outstanding'):
        call(live, 'owner', lambda s, a: payment_create(s, a, opening, pay('100000.01', bank_account_id=live.ids['bank'])))
    call(live, 'owner', lambda s, a: payment_create(s, a, opening, pay('100000', bank_account_id=live.ids['bank'])))
    assert call(live, 'viewer', lambda s, a: list_bills(s))[0]['status'] == 'paid'
    assert balance(live, '2000') == 0 and balance(live, '1010') == Decimal('249999.50')


def test_bill_from_a_supplier_added_after_go_live_posts_and_is_paid(live):
    supplier = new_party(live, 'suppliers', 'Kemi Properties')
    assert mapped(live, 'suppliers', supplier) == 0
    data = bill(live, supplier, due_date=TODAY + timedelta(days=30), notes='October rent and a lock')
    created = call(live, 'editor', lambda s, a: bill_create(s, a, data))
    assert call(live, 'editor', lambda s, a: bill_create(s, a, data)) == created  # a retry replays
    assert mapped(live, 'suppliers', supplier) == 1
    assert (balance(live, '6100'), balance(live, '6600'), balance(live, '2000')) == (Decimal('120000'), Decimal('5000'), Decimal('-275000.50'))
    row = next(b for b in call(live, 'viewer', lambda s, a: list_bills(s)) if b['supplier_name'] == 'Kemi Properties')
    assert (row['bill_number'], row['total'], row['due_date'], row['status'], row['opening']) == \
        ('INV-0042', '125000.00', (TODAY + timedelta(days=30)).isoformat(), 'unpaid', False)
    with pytest.raises(HTTPException, match='already recorded'):
        call(live, 'owner', lambda s, a: bill_create(s, a, bill(live, supplier, number=' inv-0042 ')))
    call(live, 'owner', lambda s, a: payment_create(s, a, created['id'], pay('25000', 'Cash')))
    assert balance(live, '1000') == 0 and balance(live, '2000') == Decimal('-250000.50')
    report = call(live, 'viewer', lambda s, a: trial_balance(s, TODAY))
    assert report['exceptions'] == []  # payables still agree with the bills


@pytest.mark.parametrize('change, error', [
    ({'lines': [{'account_id': 'inventory', 'amount': '100'}]}, 'expense accounts'),
    ({'lines': [{'account_id': 'cogs', 'amount': '100'}]}, 'expense accounts'),
    ({'lines': [{'account_id': '6100', 'amount': '0'}]}, 'above zero'),
    ({'entry_date': 'tomorrow'}, 'future'),
    ({'due_date': 'yesterday'}, 'due date'),
    ({'bill_number': '   '}, 'bill number'),
    ({'supplier': 'unknown'}, 'Supplier unavailable'),
    ({'supplier': 'other business'}, 'Supplier unavailable'),
])
def test_invalid_bills_post_nothing(live, change, error):
    codes = {'inventory': '1200', 'cogs': '5000', '6100': '6100'}
    supplier = {'unknown': uuid4(), 'other business': None}.get(change.pop('supplier', None), live.ids['supplier'])
    if supplier is None:
        supplier = new_party(live, 'suppliers', 'Elsewhere', business=books_other(live))
    if 'lines' in change:
        change['lines'] = [{**l, 'account_id': live.codes[codes[l['account_id']]]} for l in change['lines']]
    dates = {'tomorrow': TODAY + timedelta(days=1), 'yesterday': TODAY - timedelta(days=1)}
    for key in ('entry_date', 'due_date'):
        if key in change:
            change[key] = dates[change[key]]
    data = bill(live, supplier, lines=change.pop('lines', None)).model_copy(update=change)
    with pytest.raises(HTTPException, match=error):
        call(live, 'owner', lambda s, a: bill_create(s, a, data))
    assert balance(live, '2000') == Decimal('-150000.50') and len(call(live, 'viewer', lambda s, a: list_bills(s))) == 1


def books_other(live):
    with psycopg.connect(URL) as c:
        return c.execute("SELECT business_id FROM memberships WHERE user_id=%s AND role='owner'", (live.people['outsider'],)).fetchone()[0]


def test_viewers_cannot_record_bills_or_payments_and_unknown_bills_are_refused(live):
    with pytest.raises(HTTPException, match='Owners, Admins and Editors'):
        call(live, 'viewer', lambda s, a: bill_create(s, a, bill(live, live.ids['supplier'])))
    opening = call(live, 'viewer', lambda s, a: list_bills(s))[0]['id']
    with pytest.raises(HTTPException, match='Owners, Admins and Editors'):
        call(live, 'viewer', lambda s, a: payment_create(s, a, opening, pay('10', 'Cash')))
    with pytest.raises(HTTPException, match='Bill not found'):
        call(live, 'owner', lambda s, a: payment_create(s, a, uuid4(), pay('10', 'Cash')))
    if TODAY.timetuple().tm_yday > 1:
        early = pay('10', 'Cash').model_copy(update={'entry_date': TODAY - timedelta(days=1)})
        with pytest.raises(HTTPException, match='before its bill'):
            call(live, 'owner', lambda s, a: payment_create(s, a, opening, early))


def test_customer_added_after_go_live_can_be_invoiced(live):
    customer = new_party(live, 'customers', 'Tunde Ventures')
    data = InvoiceCreate(request_key=uuid4(), customer_id=customer, invoice_number='INV-1001', entry_date=TODAY,
                         items=[{'catalog_item_id': live.items['Rice'], 'quantity': 1, 'unit_price': '65000'}])
    result = call(live, 'editor', lambda s, a: invoice_create(s, a, data))
    assert result['posting']['amount'] == '65000.00' and mapped(live, 'customers', customer) == 1
    assert balance(live, '1100') == Decimal('125000.00')


def test_map_party_refuses_other_businesses_and_viewers(live):
    foreign = new_party(live, 'suppliers', 'Elsewhere', business=books_other(live))
    for who, party, error in (('owner', foreign, 'PARTY_UNAVAILABLE'), ('viewer', live.ids['supplier'], 'write permission')):
        with pytest.raises(Exception, match=error):
            call(live, who, lambda s, a: s.connection().exec_driver_sql('SELECT accounting.map_party(%s,%s,%s)', (str(live.business), 'suppliers', str(party))).scalar())
