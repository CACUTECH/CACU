"""Purchasing, part 2 (Doc 10 purchase-to-payment and rules, Doc 09 PR-18): goods received against a sent order or on their
own put stock up at the actual cost, recalculate the weighted-average cost and post Dr Inventory, Cr Goods received not
invoiced; supplier returns take goods back at the received cost. On a business started from the real chart."""
from decimal import Decimal
from uuid import uuid4
import psycopg
import pytest
import sqlalchemy.exc
from fastapi import HTTPException
from cacu.accounting.posting import raw
from cacu.accounting.purchasing import GoodsReceive, SupplierReturn, list_receipts, receive, return_goods
from cacu.accounting.workflows import sale_create
from test_corrections_postgres import live, call, balance, stock, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_pos_checkout_postgres import as_template, sale
from test_pos_refunds_postgres import as_member, books_balance
from test_pos_shifts_postgres import on_plan
from test_purchase_orders_postgres import order, line, status

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


def sent_order(live, *lines):
    made = order(live)[0]
    for name, quantity, cost in lines:
        line(live, made, name, quantity, cost)
    status(live, made, "status='sent'")
    return made


def got(live, who='owner', key=None, **kw):
    lines = kw.pop('lines')
    data = GoodsReceive(request_key=key or uuid4(), lines=[{'item_id': live.items[n], 'quantity': q, 'unit_cost': c} for n, q, c in lines], **kw)
    return call(live, who, lambda s, a: receive(s, a, data)), data


def cost(live, name):
    with psycopg.connect(URL) as c:
        return c.execute('SELECT cost_price FROM catalog_items WHERE id=%s', (live.items[name],)).fetchone()[0]


def grni(live):
    with psycopg.connect(URL) as c:
        return c.execute("""SELECT a.code,a.name FROM accounting.account_map m JOIN accounts a ON a.id=m.account_id
                            WHERE m.business_id=%s AND m.purpose='grni'""", (live.business,)).fetchone()


def test_receiving_against_an_order_raises_stock_at_the_weighted_average_and_owes_the_supplier(live):
    made = sent_order(live, ('Beans', 24, '1200.50'), ('Rice', 5, '50000'))
    stock_value = balance(live, '1200')
    receipt, data = got(live, order_id=made, lines=[('Beans', 20, '1300'), ('Rice', 5, '50000')])
    assert (receipt['number'], receipt['total'], receipt['order_number']) == ('GR-0001', '276000.00', 'PO-0001')
    assert call(live, 'owner', lambda s, a: receive(s, a, data)) == receipt  # a retry receives once
    assert grni(live) == ('2010', 'Goods received not invoiced')
    assert balance(live, '1200') - stock_value == Decimal('276000') and balance(live, '2010') == Decimal('-276000')
    assert stock(live, 'Beans')[0] == 23 and stock(live, 'Rice')[0] == 15
    assert cost(live, 'Beans') == Decimal('1287.0217') and cost(live, 'Rice') == Decimal('50000')  # (3 x 1,200.50 + 20 x 1,300) / 23
    assert as_member(live, 'owner', 'SELECT status FROM purchase_orders WHERE id=%s', made) == [('partly_received',)]
    with pytest.raises(HTTPException, match='Only 4 more were ordered'):
        got(live, order_id=made, lines=[('Beans', 5, '1300')])
    got(live, order_id=made, lines=[('Beans', 4, '1300')])
    assert as_member(live, 'owner', 'SELECT status FROM purchase_orders WHERE id=%s', made) == [('received',)]
    with pytest.raises(HTTPException, match='This order is received'):
        got(live, order_id=made, lines=[('Beans', 1, '1300')])
    draft = order(live)[0]
    with pytest.raises(HTTPException, match='only against a sent order'):
        got(live, order_id=draft, lines=[('Beans', 1, '1300')])
    other = sent_order(live, ('Rice', 1, '50000'))
    with pytest.raises(HTTPException, match='not on this order'):
        got(live, order_id=other, lines=[('Beans', 1, '1300')])
    assert [r['number'] for r in call(live, 'owner', lambda s, a: list_receipts(s, made))] == ['GR-0002', 'GR-0001']
    # A sale now costs goods at the new average.
    cogs = balance(live, '5000')
    call(live, 'owner', lambda s, a: sale_create(s, a, sale(live, lines=(('Beans', 1, '0'),))))
    assert balance(live, '5000') - cogs == cost(live, 'Beans')
    books_balance(live)


def test_receipts_on_their_own_and_returns_to_the_supplier(live):
    as_template(live, 'editor', 'inventory_manager')
    with pytest.raises(HTTPException, match='Choose the supplier'):
        got(live, lines=[('Beans', 10, '1250')])
    with pytest.raises(HTTPException, match='must be received by the owner or an admin'):
        got(live, 'editor', supplier_id=live.ids['supplier'], lines=[('Beans', 10, '1250')])
    first, _ = got(live, supplier_id=live.ids['supplier'], lines=[('Beans', 10, '1250')])
    second, _ = got(live, 'editor', supplier_id=live.ids['supplier'], note='Delivery note 77', lines=[('Rice', 2, '52000')])
    assert (first['order_id'], second['number'], second['note']) == (None, 'GR-0002', 'Delivery note 77')
    held, on_hand, average = balance(live, '2010'), stock(live, 'Beans')[0], cost(live, 'Beans')
    returned = call(live, 'editor', lambda s, a: return_goods(s, a, first['id'], SupplierReturn(request_key=uuid4(), reason='Two tins dented',
                    lines=[{'item_id': live.items['Beans'], 'quantity': 2}])))
    assert [l['returnable'] for l in returned['lines']] == [8] and returned['returns'][0]['total'] == '2500.00'
    assert balance(live, '2010') - held == Decimal('2500') and stock(live, 'Beans')[0] == on_hand - 2
    assert cost(live, 'Beans') == ((on_hand * average - Decimal('2500')) / (on_hand - 2)).quantize(Decimal('0.0001'))
    with pytest.raises(HTTPException, match='Only 8 can still be returned'):
        call(live, 'editor', lambda s, a: return_goods(s, a, first['id'], SupplierReturn(request_key=uuid4(), reason='More dents',
             lines=[{'item_id': live.items['Beans'], 'quantity': 9}])))
    with pytest.raises(HTTPException, match='not on this receipt'):
        call(live, 'editor', lambda s, a: return_goods(s, a, first['id'], SupplierReturn(request_key=uuid4(), reason='Wrong item',
             lines=[{'item_id': live.items['Rice'], 'quantity': 1}])))
    books_balance(live)


def test_costs_change_only_through_a_receipt_and_purchasing_needs_its_plan(live):
    with pytest.raises(sqlalchemy.exc.DBAPIError, match='COST_REVALUATION_REQUIRED'):
        call(live, 'owner', lambda s, a: raw(s, 'UPDATE public.catalog_items SET cost_price=1 WHERE business_id=%s AND id=%s', (str(live.business), str(live.items['Beans']))))
    on_plan(live, 'BASE')
    with pytest.raises(HTTPException, match='Oga and Chairman plans'):
        got(live, supplier_id=live.ids['supplier'], lines=[('Beans', 1, '1300')])
