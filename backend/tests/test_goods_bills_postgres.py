"""Purchasing, part 3 (Doc 10 purchase-to-payment, Doc 09 PR-18): the supplier's bill for received goods clears Goods
received not invoiced against payables, is listed and paid like any bill, and any difference from the received cost
adjusts stock cost (IAS 2): units still in stock take their share, units already sold send theirs to cost of sales."""
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.bills import SupplierPaymentCreate, list_bills, payment_create
from cacu.accounting.purchasing import GoodsBill, SupplierReturn, bill_received, detail, return_goods
from cacu.accounting.workflows import sale_create
from test_corrections_postgres import live, call, balance, stock, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_pos_checkout_postgres import as_template, sale
from test_pos_refunds_postgres import books_balance
from test_pos_shifts_postgres import on_plan
from test_goods_receipts_postgres import got, cost
from test_activation_postgres import TODAY

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


def bill(live, receipt, quantity, amount, who='owner', number='INV-101', supplier=None, **kw):
    data = GoodsBill(request_key=uuid4(), supplier_id=supplier or live.ids['supplier'], bill_number=number, entry_date=kw.pop('entry_date', TODAY),
                     lines=[{'receipt_id': receipt['id'], 'item_id': live.items['Beans'], 'quantity': quantity, 'amount': amount}], **kw)
    return call(live, who, lambda s, a: bill_received(s, a, data)), data


def test_a_bill_above_the_received_cost_clears_the_receipt_and_raises_the_cost_of_stock_still_held(live):
    receipt, _ = got(live, supplier_id=live.ids['supplier'], lines=[('Beans', 20, '1300')])
    held, payables, stock_value = balance(live, '2010'), balance(live, '2000'), balance(live, '1200')
    average = cost(live, 'Beans')
    billed, data = bill(live, receipt, 20, '27000.00', due_date=TODAY + timedelta(days=30))
    assert (billed['total'], billed['received_value'], billed['difference_to_stock'], billed['difference_to_cost_of_sales']) == ('27000.00', '26000.00', '1000.00', '0.00')
    assert call(live, 'owner', lambda s, a: bill_received(s, a, data)) == billed  # a retry bills once
    assert balance(live, '2010') - held == Decimal('26000') and balance(live, '2000') - payables == Decimal('-27000')
    assert balance(live, '1200') - stock_value == Decimal('1000')
    assert cost(live, 'Beans') == ((23 * average + Decimal('1000')) / 23).quantize(Decimal('0.0001'))
    listed = next(b for b in call(live, 'owner', lambda s, a: list_bills(s)) if b['id'] == billed['id'])
    assert (listed['bill_number'], listed['total'], listed['status']) == ('INV-101', '27000.00', 'unpaid')
    call(live, 'owner', lambda s, a: payment_create(s, a, billed['id'], SupplierPaymentCreate(request_key=uuid4(), amount='10000', entry_date=TODAY, method='Cash')))
    listed = next(b for b in call(live, 'owner', lambda s, a: list_bills(s)) if b['id'] == billed['id'])
    assert (listed['outstanding'], listed['status']) == ('17000.00', 'part_paid')
    with pytest.raises(HTTPException, match='already recorded'):
        bill(live, receipt, 1, '1300.00', number='inv-101 ')
    with pytest.raises(HTTPException, match='already been billed or returned'):
        bill(live, receipt, 1, '1300.00', number='INV-102')
    assert [l['returnable'] for l in call(live, 'owner', lambda s, a: detail(s, receipt['id']))['lines']] == [0]
    with pytest.raises(HTTPException, match='Nothing of that product can still be returned'):
        call(live, 'owner', lambda s, a: return_goods(s, a, receipt['id'], SupplierReturn(request_key=uuid4(), reason='Too late',
             lines=[{'item_id': live.items['Beans'], 'quantity': 1}])))
    books_balance(live)


def test_a_cheaper_bill_after_some_goods_were_sold_splits_the_difference_between_stock_and_cost_of_sales(live):
    receipt, _ = got(live, supplier_id=live.ids['supplier'], lines=[('Beans', 10, '1300')])  # 13 on hand
    call(live, 'owner', lambda s, a: sale_create(s, a, sale(live, lines=(('Beans', 8, '0'),))))  # 5 left
    assert stock(live, 'Beans')[0] == 5
    held, stock_value, cogs = balance(live, '2010'), balance(live, '1200'), balance(live, '5000')
    billed, _ = bill(live, receipt, 10, '12000.00')
    assert (billed['difference_to_stock'], billed['difference_to_cost_of_sales']) == ('-500.00', '-500.00')  # 5 of the 10 still held
    assert balance(live, '2010') - held == Decimal('13000')  # cleared at the received cost
    assert balance(live, '1200') - stock_value == Decimal('-500') and balance(live, '5000') - cogs == Decimal('-500')
    books_balance(live)


def test_bills_must_match_the_suppliers_own_receipts_and_dates(live):
    receipt, _ = got(live, supplier_id=live.ids['supplier'], lines=[('Beans', 4, '1300')])
    other = uuid4()
    with psycopg.connect(URL) as c:
        c.execute("INSERT INTO suppliers(id,business_id,name) VALUES(%s,%s,'Kemi Foods')", (other, live.business))
    with pytest.raises(HTTPException, match='from another supplier'):
        bill(live, receipt, 4, '5200.00', supplier=other)
    with pytest.raises(HTTPException, match='before its goods were received'):
        bill(live, receipt, 4, '5200.00', entry_date=TODAY - timedelta(days=1))
    with pytest.raises(HTTPException, match='Only 4 can still be billed'):
        bill(live, receipt, 5, '6500.00')
    with pytest.raises(HTTPException, match='Only Owners, Admins and Editors'):
        bill(live, receipt, 4, '5200.00', who='viewer')
    on_plan(live, 'BASE')
    with pytest.raises(HTTPException, match='Oga and Chairman plans'):
        bill(live, receipt, 4, '5200.00')
