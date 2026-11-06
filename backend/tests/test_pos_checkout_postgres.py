"""POS, part 2 (Doc 10 checkout rules, BR-010, BR-022): cash received and change, discounts within the member's cap,
split cash and transfer, credit to a named customer, overselling off by default, and the receipt. On a business
started from the real chart, as in the release-gate tests."""
import json
from decimal import Decimal
from pathlib import Path
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.workflows import SaleCreate, sale_create
from cacu.accounting.transfers import TransferConfirm, TransferNotReceived, confirm, not_received, daily
from cacu.accounting.checkout import SalesPolicy, options, save_policy, shortfalls, review_shortfall, receipt
from cacu.accounting.reports import cash_flow, trial_balance
from test_corrections_postgres import live, call, balance, stock, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_activation_postgres import TODAY

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
MIGRATIONS = Path(__file__).resolve().parents[2] / 'supabase/migrations'


def sale(live, method='Cash', lines=(('Beans', 1, '0'),), quoted=None, **extra):
    prices = {'Rice': Decimal('65000'), 'Beans': Decimal('1500')}
    total = quoted or sum(prices[name] * qty * (100 - Decimal(pct)) / 100 for name, qty, pct in lines)
    return SaleCreate(request_key=uuid4(), entry_date=TODAY, method=method, quoted_total=format(Decimal(total).quantize(Decimal('0.01')), 'f'),
                      items=[{'item_id': live.items[name], 'quantity': qty, 'discount_percent': pct} for name, qty, pct in lines], **extra)


def as_template(live, who, template):
    with psycopg.connect(URL) as c:
        c.execute("""UPDATE memberships SET role_template_id=(SELECT id FROM authz.role_templates WHERE code=%s AND business_id IS NULL)
                     WHERE business_id=%s AND user_id=%s""", (template, live.business, live.people[who]))


def test_cash_received_change_and_an_owner_discount_are_on_the_receipt(live):
    data = sale(live, lines=(('Beans', 2, '10'),), cash_received='3000')
    made = call(live, 'owner', lambda s, a: sale_create(s, a, data))
    assert made['change'] == '300.00' and made['discount_total'] == '300.00' and made['status'] == 'completed'
    slip = call(live, 'owner', lambda s, a: receipt(s, data.request_key))
    assert slip['number'] and slip['total'] == '2700.00' and slip['subtotal'] == '3000.00'
    assert slip['cash_received'] == '3000.00' and slip['change'] == '300.00'
    assert slip['items'] == [{'name': 'Beans', 'quantity': 2, 'unit_price': '1500.00', 'discount': '300.00', 'total': '2700.00'}]
    with pytest.raises(HTTPException, match='less than the cash due'):
        call(live, 'owner', lambda s, a: sale_create(s, a, sale(live, cash_received='1000')))


def test_a_cashier_discounts_up_to_their_cap_and_the_owner_can_raise_it(live):
    as_template(live, 'editor', 'cashier')
    assert call(live, 'editor', lambda s, a: options(s))['discount_cap'] == '5'
    assert call(live, 'editor', lambda s, a: sale_create(s, a, sale(live, lines=(('Beans', 1, '5'),))))['discount_total'] == '75.00'
    with pytest.raises(HTTPException) as refused:
        call(live, 'editor', lambda s, a: sale_create(s, a, sale(live, lines=(('Beans', 1, '6'),))))
    assert refused.value.status_code == 403 and 'limit is 5%' in refused.value.detail
    with psycopg.connect(URL) as c:
        cashier = c.execute("SELECT id FROM authz.role_templates WHERE code='cashier' AND business_id IS NULL").fetchone()[0]
        c.execute('SET LOCAL ROLE authenticated')
        c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': str(live.people['owner'])}),))
        c.execute('SELECT public.save_discount_cap(%s,%s,%s)', (live.business, cashier, 10))
    assert call(live, 'editor', lambda s, a: options(s))['discount_cap'] == '10'
    assert call(live, 'editor', lambda s, a: sale_create(s, a, sale(live, lines=(('Rice', 1, '6'),))))['discount_total'] == '3900.00'
    as_template(live, 'editor', 'auditor')  # no sales.edit: no discounts at all
    assert call(live, 'editor', lambda s, a: options(s))['discount_cap'] == '0'


def test_split_sales_bank_the_cash_now_and_the_transfer_on_confirmation_or_reverse_entirely(live):
    start = {code: balance(live, code) for code in ('1000', '1010', '1020', '4000')}
    on_hand = stock(live, 'Rice')[0]
    first, second = (sale(live, 'Split', (('Rice', 1, '0'),), transfer_amount='40000', cash_received='30000') for _ in range(2))
    made = call(live, 'owner', lambda s, a: sale_create(s, a, first))
    assert made['status'] == 'pending_payment' and made['change'] == '5000.00'
    call(live, 'owner', lambda s, a: sale_create(s, a, second))
    assert balance(live, '1000') - start['1000'] == Decimal('50000') and balance(live, '1020') - start['1020'] == Decimal('80000')
    summary = call(live, 'owner', lambda s, a: daily(s, TODAY))['by_method']['split']
    assert summary == {'sales': 2, 'total': '130000.00', 'awaiting': '80000.00', 'reversed': '0.00'}
    call(live, 'owner', lambda s, a: confirm(s, a, first.request_key, TransferConfirm(request_key=uuid4(), bank_account_id=live.ids['bank'])))
    gone = call(live, 'owner', lambda s, a: not_received(s, a, second.request_key, TransferNotReceived(request_key=uuid4(), note='Transfer bounced')))
    assert gone['cash_to_refund'] == '25000.00'
    assert balance(live, '1010') - start['1010'] == Decimal('40000') and balance(live, '1020') == start['1020']
    assert balance(live, '1000') - start['1000'] == Decimal('25000')  # the second customer's cash went back
    assert -(balance(live, '4000') - start['4000']) == Decimal('65000') and stock(live, 'Rice')[0] == on_hand - 1
    assert call(live, 'viewer', lambda s, a: trial_balance(s, TODAY))['difference'] == '0.00'
    assert call(live, 'viewer', lambda s, a: cash_flow(s, TODAY, TODAY))['reconciled']


def test_a_credit_sale_is_an_issued_invoice_to_the_named_customer(live):
    start = balance(live, '1100')
    with pytest.raises(HTTPException, match='Choose the customer'):
        call(live, 'owner', lambda s, a: sale_create(s, a, sale(live, 'Credit')))
    made = call(live, 'owner', lambda s, a: sale_create(s, a, sale(live, 'Credit', (('Beans', 2, '0'),), customer_id=live.ids['ada'])))
    assert made['status'] == 'credit' and made['invoice_number'].startswith('POS-')
    assert balance(live, '1100') - start == Decimal('3000')
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT status,customer_id FROM invoices WHERE id=%s', (made['invoice_id'],)).fetchone() == ('sent', live.ids['ada'])
    with pytest.raises(HTTPException, match='not available on credit'):
        call(live, 'owner', lambda s, a: sale_create(s, a, sale(live, 'Credit', (('Beans', 1, '5'),), customer_id=live.ids['ada'])))


def test_overselling_is_off_until_the_owner_allows_it_then_shortfalls_wait_for_review(live):
    beans = stock(live, 'Beans')[0]
    too_many = lambda: sale(live, lines=(('Beans', beans + 2, '0'),))
    with pytest.raises(HTTPException) as blocked:
        call(live, 'owner', lambda s, a: sale_create(s, a, too_many()))
    assert blocked.value.status_code == 409
    with pytest.raises(HTTPException) as admin:
        call(live, 'admin', lambda s, a: save_policy(s, a, SalesPolicy(allow_oversell=True)))
    assert admin.value.status_code == 403
    assert call(live, 'owner', lambda s, a: save_policy(s, a, SalesPolicy(allow_oversell=True))) == {'allow_oversell': True}
    cost_before = balance(live, '5000')
    data = too_many()
    made = call(live, 'owner', lambda s, a: sale_create(s, a, data))
    assert made['shortfalls'] == [{'item_id': str(live.items['Beans']), 'quantity': 2}]
    assert stock(live, 'Beans')[0] == 0
    assert balance(live, '5000') - cost_before == Decimal('1200.50') * beans  # only the units on hand are costed
    listed = call(live, 'owner', lambda s, a: shortfalls(s))
    assert [(f['item'], f['quantity']) for f in listed] == [('Beans', 2)]
    call(live, 'owner', lambda s, a: review_shortfall(s, a, data.request_key, live.items['Beans']))
    assert call(live, 'owner', lambda s, a: shortfalls(s)) == []
    assert call(live, 'viewer', lambda s, a: trial_balance(s, TODAY))['exceptions'] == []
