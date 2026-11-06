"""POS, part 3 (Doc 10 refunds and sale states, PR-16, FR-044): refunds bounded by what was sold, revenue taken back at the
net price, resaleable goods back in stock at their original cost, approval by the owner's rule, and parked sales.
On a business started from the real chart, as in the release-gate tests."""
import json
from decimal import Decimal
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.workflows import sale_create
from cacu.accounting.transfers import TransferConfirm, confirm, daily
from cacu.accounting.checkout import receipt
from cacu.accounting.refunds import (RefundDecision, RefundPolicy, RefundRequest, decide, list_refunds, refundable, request,
                                     sales_on, save_refund_policy)
from cacu.accounting.reports import cash_flow, trial_balance
from test_corrections_postgres import live, call, balance, stock, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_pos_checkout_postgres import sale, as_template
from test_activation_postgres import TODAY

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
BEAN_COST = Decimal('1200.50')


def sold(live, who='owner', **kw):
    data = sale(live, **kw)
    call(live, who, lambda s, a: sale_create(s, a, data))
    return data.request_key


def line(live, sale_id, name='Beans'):
    return next(l for l in call(live, 'owner', lambda s, a: refundable(s, sale_id))['lines'] if l['name'] == name)


def refund(live, who, sale_id, quantity, method='Cash', restock=True, key=None, **kw):
    data = RefundRequest(request_key=key or uuid4(), method=method, reason='Customer changed their mind',
                         lines=[{'line_id': line(live, sale_id)['line_id'], 'quantity': quantity, 'restock': restock}], **kw)
    return call(live, who, lambda s, a: request(s, a, sale_id, data)), data


def books_balance(live):
    assert call(live, 'viewer', lambda s, a: trial_balance(s, TODAY))['difference'] == '0.00'
    assert call(live, 'viewer', lambda s, a: cash_flow(s, TODAY, TODAY))['reconciled']


def test_the_owner_refunds_part_then_the_rest_at_the_net_price_with_goods_back_at_cost(live):
    sale_id = sold(live, lines=(('Beans', 3, '10'),))  # 4,050 after 10% off
    start = {code: balance(live, code) for code in ('1000', '4000', '5000')}
    on_hand = stock(live, 'Beans')[0]
    first, data = refund(live, 'owner', sale_id, 1)
    assert first['status'] == 'posted' and first['amount'] == '1350.00' and first['items'] == '1 x Beans'
    assert call(live, 'owner', lambda s, a: request(s, a, sale_id, data)) == first  # a retried request refunds once
    assert balance(live, '1000') - start['1000'] == Decimal('-1350') and balance(live, '4000') - start['4000'] == Decimal('1350')
    assert stock(live, 'Beans')[0] == on_hand + 1 and start['5000'] - balance(live, '5000') == BEAN_COST
    slip = call(live, 'owner', lambda s, a: receipt(s, sale_id))
    assert slip['status'] == 'refunded' and slip['refunded_total'] == '1350.00'
    assert line(live, sale_id) | {'line_id': None, 'item_id': None} == {'line_id': None, 'item_id': None, 'name': 'Beans', 'quantity': 3,
                                                                          'refundable': 2, 'refundable_amount': '2700.00', 'restockable': True}
    with pytest.raises(HTTPException, match='Only 2 x Beans'):
        refund(live, 'owner', sale_id, 3)
    assert refund(live, 'owner', sale_id, 2)[0]['amount'] == '2700.00'
    with pytest.raises(HTTPException, match='already been refunded'):
        refund(live, 'owner', sale_id, 1)
    assert -(balance(live, '4000') - start['4000']) == Decimal('-4050') and stock(live, 'Beans')[0] == on_hand + 3
    assert [s['refunded_total'] for s in call(live, 'owner', lambda s, a: sales_on(s, TODAY)) if s['id'] == str(sale_id)] == ['4050.00']
    books_balance(live)


def test_a_cashier_asks_and_an_approver_pays_back_a_confirmed_transfer_without_restocking(live):
    as_template(live, 'editor', 'cashier')
    sale_id = sold(live, 'editor', method='Transfer', lines=(('Beans', 2, '0'),))
    with pytest.raises(HTTPException, match='awaiting confirmation'):
        refund(live, 'editor', sale_id, 1)
    call(live, 'owner', lambda s, a: confirm(s, a, sale_id, TransferConfirm(request_key=uuid4(), bank_account_id=live.ids['bank'])))
    assert call(live, 'editor', lambda s, a: refundable(s, sale_id))['default_method'] == 'Transfer'
    start = {code: balance(live, code) for code in ('1010', '4000')}
    on_hand = stock(live, 'Beans')[0]
    asked, _ = refund(live, 'editor', sale_id, 1, method='Transfer', restock=False)
    assert asked['status'] == 'pending' and asked['mine'] and balance(live, '1010') == start['1010']
    with pytest.raises(HTTPException, match='Only 1 x Beans'):  # a waiting request holds its units
        refund(live, 'editor', sale_id, 2, method='Transfer')
    with pytest.raises(HTTPException) as cashier:
        call(live, 'editor', lambda s, a: decide(s, a, asked['id'], True, RefundDecision()))
    assert cashier.value.status_code == 403
    assert [r['id'] for r in call(live, 'admin', lambda s, a: list_refunds(s, 'pending', a))] == [asked['id']]
    with pytest.raises(HTTPException, match='Choose the bank account'):
        call(live, 'admin', lambda s, a: decide(s, a, asked['id'], True, RefundDecision()))
    paid = call(live, 'admin', lambda s, a: decide(s, a, asked['id'], True, RefundDecision(bank_account_id=live.ids['bank'], note='Damaged tin')))
    assert paid['status'] == 'posted' and paid['posting']['stock_cost_restored'] == '0.00'
    assert balance(live, '1010') - start['1010'] == Decimal('-1500') and balance(live, '4000') - start['4000'] == Decimal('1500')
    assert stock(live, 'Beans')[0] == on_hand  # not resaleable: stays out of stock, its cost stays in cost of sales
    with pytest.raises(HTTPException, match='already posted'):
        call(live, 'admin', lambda s, a: decide(s, a, asked['id'], False, RefundDecision(note='Too late')))
    report = call(live, 'owner', lambda s, a: daily(s, TODAY, a))
    assert report['refunds'] == {'transfer': {'refunds': 1, 'total': '1500.00'}} and report['refunds_pending'] == []
    books_balance(live)


def test_the_owners_limit_and_separation_of_duties_decide_who_refunds(live):
    with pytest.raises(HTTPException) as admin:
        call(live, 'admin', lambda s, a: save_refund_policy(s, a, RefundPolicy(refund_threshold='2000')))
    assert admin.value.status_code == 403
    assert call(live, 'owner', lambda s, a: save_refund_policy(s, a, RefundPolicy(refund_threshold='2000'))) == {'refund_threshold': '2000.00'}
    sale_id = sold(live, lines=(('Beans', 3, '0'),))
    assert refund(live, 'admin', sale_id, 1)[0]['status'] == 'posted'  # 1,500: within the limit
    above, _ = refund(live, 'admin', sale_id, 2)  # 3,000: above it
    assert above['status'] == 'pending'
    with pytest.raises(HTTPException, match='Someone other than the requester'):
        call(live, 'admin', lambda s, a: decide(s, a, above['id'], True, RefundDecision()))
    with pytest.raises(HTTPException, match='Say why'):
        call(live, 'owner', lambda s, a: decide(s, a, above['id'], False, RefundDecision()))
    turned = call(live, 'owner', lambda s, a: decide(s, a, above['id'], False, RefundDecision(note='Goods were used')))
    assert turned['status'] == 'rejected' and line(live, sale_id)['refundable'] == 2  # the units are free again
    withdrawn, _ = refund(live, 'admin', sale_id, 2)
    assert call(live, 'admin', lambda s, a: decide(s, a, withdrawn['id'], False, RefundDecision()))['decision_note'] == 'Withdrawn by the requester'
    books_balance(live)


def as_member(live, who, sql, *args):
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE authenticated')
        c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': str(live.people[who])}),))
        return c.execute(sql, args).fetchall()


def test_parked_sales_are_shared_by_people_who_sell_and_hidden_from_others(live):
    as_template(live, 'editor', 'cashier')
    cart = json.dumps([{'item_id': str(live.items['Beans']), 'quantity': 2, 'discount_percent': '0'}])
    parked = as_member(live, 'editor', 'INSERT INTO parked_sales(business_id,label,items) VALUES(%s,%s,%s) RETURNING id,created_by',
                       live.business, 'Ada, fetching money', cart)[0]
    assert parked[1] == live.people['editor']
    assert [r[0] for r in as_member(live, 'owner', 'SELECT id FROM parked_sales WHERE business_id=%s', live.business)] == [parked[0]]
    with pytest.raises(psycopg.errors.InsufficientPrivilege):  # parked carts are never changed, only resumed or discarded
        as_member(live, 'owner', 'UPDATE parked_sales SET label=%s WHERE id=%s RETURNING id', 'x', parked[0])
    as_template(live, 'viewer', 'auditor')
    assert as_member(live, 'viewer', 'SELECT id FROM parked_sales') == []
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_member(live, 'viewer', 'INSERT INTO parked_sales(business_id,items) VALUES(%s,%s) RETURNING id', live.business, cart)
    assert as_member(live, 'owner', 'DELETE FROM parked_sales WHERE id=%s RETURNING id', parked[0]) == [(parked[0],)]
