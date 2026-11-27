"""Corrections (27 November 2026): an asset entered in error is removed by the Owner with every journal it made
reversed, dated today, and leaves the register; a payroll payment recorded in error is reversed and is owed again."""
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.assets import Dispose, Remove, add_asset, dispose, overview, remove
from cacu.accounting.bills import SupplierPaymentCreate, list_bills, payment_create
from cacu.accounting.payroll import PostRun, ReversePayment, post_run, reverse_payment, settle
from cacu.accounting.reports import opening_transactions
from test_fixed_assets_postgres import EARLIER_MONTH, LAST_MONTH, asset, by_purpose, post, started
from test_payroll_posting_postgres import balance, pay, payroll_run, switch
from test_corrections_postgres import live, call, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_activation_postgres import TODAY

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
WHY = Remove(request_key=uuid4(), reason='Entered twice by mistake')


def test_an_asset_entered_in_error_is_removed_with_everything_it_posted(live):
    started(live, EARLIER_MONTH)
    cash_before = by_purpose(live, 'cash')
    laptop = call(live, 'owner', lambda s, a: add_asset(s, a, asset()))
    post(live, EARLIER_MONTH)
    call(live, 'owner', lambda s, a: dispose(s, a, laptop['id'], Dispose(request_key=uuid4(), disposed_on=LAST_MONTH, proceeds='1150000.00', method='Cash')))
    for who in ('admin', 'editor'):
        with pytest.raises(HTTPException) as refused:
            call(live, who, lambda s, a: remove(s, a, laptop['id'], WHY))
        assert refused.value.status_code == 403
    gone = call(live, 'owner', lambda s, a: remove(s, a, laptop['id'], WHY))
    assert gone['removed_on'] == TODAY.isoformat()
    for purpose in ('asset_computers', 'accdep_computers', 'depreciation', 'disposal_gains'):
        assert by_purpose(live, purpose) == 0, purpose
    assert by_purpose(live, 'cash') == cash_before  # the purchase and the sale are both undone
    view = call(live, 'viewer', lambda s, a: overview(s))
    assert view['assets'] == [] and view['due'] == []
    assert call(live, 'owner', lambda s, a: remove(s, a, laptop['id'], WHY))['removed_on'] == TODAY.isoformat()  # retried
    with pytest.raises(HTTPException) as missing:
        call(live, 'owner', lambda s, a: dispose(s, a, laptop['id'], Dispose(request_key=uuid4(), disposed_on=TODAY)))
    assert missing.value.status_code == 404
    with psycopg.connect(URL) as c:  # the history stays: the original entries and their reversals
        assert c.execute("SELECT count(*) FROM accounting.document_map WHERE business_id=%s AND source_type='asset_removal'", (live.business,)).fetchone()[0] == 3


def test_an_asset_bought_on_credit_is_removed_only_while_its_bill_is_unpaid(live):
    started(live, EARLIER_MONTH)
    supplier = uuid4()
    with psycopg.connect(URL) as c:
        c.execute('INSERT INTO suppliers(id,business_id,name) VALUES(%s,%s,%s)', (supplier, live.business, 'Ikeja Furniture'))
    shelves = call(live, 'owner', lambda s, a: add_asset(s, a, asset(name='Shelves', category='furniture', how='credit', pay_method=None,
                                                                  supplier_id=supplier, bill_number='IF-78', cost='250000.00')))
    paid = call(live, 'owner', lambda s, a: add_asset(s, a, asset(name='Desk', category='furniture', how='credit', pay_method=None,
                                                               supplier_id=supplier, bill_number='IF-79', cost='80000.00')))
    bill = next(b for b in call(live, 'viewer', lambda s, a: list_bills(s)) if b['bill_number'] == 'IF-79')
    call(live, 'owner', lambda s, a: payment_create(s, a, bill['id'], SupplierPaymentCreate(request_key=uuid4(), amount='1000.00', entry_date=TODAY, method='Cash')))
    with pytest.raises(HTTPException, match='Something has been paid'):
        call(live, 'owner', lambda s, a: remove(s, a, paid['id'], WHY))
    call(live, 'owner', lambda s, a: remove(s, a, shelves['id'], WHY))
    cleared = next(b for b in call(live, 'viewer', lambda s, a: list_bills(s)) if b['bill_number'] == 'IF-78')
    assert (cleared['outstanding'], cleared['status']) == ('0.00', 'paid')  # the bill is cleared by the reversal
    assert by_purpose(live, 'asset_furniture') == Decimal('80000')  # only the desk remains


def test_an_asset_owned_before_cacu_is_removed_as_a_position_brought_in(live):
    started(live, EARLIER_MONTH)
    retained = by_purpose(live, 'retained_earnings')
    van = call(live, 'owner', lambda s, a: add_asset(s, a, asset(name='Van', category='vehicles', how='existing', pay_method=None,
        acquired_on=EARLIER_MONTH - timedelta(days=700), brought_in_on=EARLIER_MONTH, cost='600000.00', accumulated_depreciation='300000.00')))
    call(live, 'owner', lambda s, a: remove(s, a, van['id'], WHY))
    assert by_purpose(live, 'retained_earnings') == retained and by_purpose(live, 'asset_vehicles') == 0 and by_purpose(live, 'accdep_vehicles') == 0
    with psycopg.connect(URL) as c:
        reversal = c.execute("SELECT transaction_id FROM accounting.document_map WHERE business_id=%s AND source_type='asset_removal'", (live.business,)).fetchone()[0]
    assert reversal in call(live, 'owner', lambda s, a: opening_transactions(s))  # left out of the cash flow, like the bringing-in


def test_a_payroll_payment_recorded_in_error_is_reversed_and_owed_again(live):
    switch(True)
    run = payroll_run(live)
    call(live, 'owner', lambda s, a: post_run(s, a, run, PostRun(request_key=uuid4())))
    done = call(live, 'owner', lambda s, a: settle(s, a, run, pay('net_pay', '400000.00')))
    payment = done['settlements'][0]['id']
    assert done['outstanding']['net_pay'] == '20000.00'
    with pytest.raises(HTTPException) as refused:
        call(live, 'admin', lambda s, a: reverse_payment(s, a, run, payment, ReversePayment(request_key=uuid4(), reason='Wrong bank account')))
    assert refused.value.status_code == 403
    back = call(live, 'owner', lambda s, a: reverse_payment(s, a, run, payment, ReversePayment(request_key=uuid4(), reason='Wrong bank account')))
    assert back['outstanding']['net_pay'] == '420000.00' and back['settlements'][0]['reversed'] is True
    assert balance(live, 'salaries_payable') == Decimal('420000')
    again = call(live, 'owner', lambda s, a: reverse_payment(s, a, run, payment, ReversePayment(request_key=uuid4(), reason='Wrong bank account')))
    assert again['outstanding'] == back['outstanding']  # reversing again changes nothing
    call(live, 'owner', lambda s, a: settle(s, a, run, pay('net_pay', '420000.00')))  # and it can be paid properly
    switch(False)
