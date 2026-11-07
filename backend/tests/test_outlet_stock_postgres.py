"""Purchasing, part 4a (Doc 10; owner decisions of 7 November 2026): once a business has outlets, its stock is held per
outlet. The first outlet takes all the stock; goods are received into a chosen outlet; a till sale takes stock from the
seller's shift outlet and an outlet cannot sell what it does not hold; refunds go back where the sale came from; supplier
returns leave from the receipt's outlet; anything else lands on the main outlet. The split always adds up to the total."""
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.outlets import stock as by_outlet
from cacu.accounting.purchasing import SupplierReturn, return_goods
from cacu.accounting.shifts import ShiftOpen, current, start
from cacu.accounting.stock import request_adjustment
from test_corrections_postgres import live, call, stock, adjustment, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_pos_checkout_postgres import as_template
from test_pos_refunds_postgres import books_balance, refund, sold
from test_goods_receipts_postgres import got

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


def outlet(live, name):
    with psycopg.connect(URL) as c:
        return str(c.execute('INSERT INTO business_locations(business_id,name) VALUES(%s,%s) RETURNING id', (live.business, name)).fetchone()[0])


def split(live, name):
    with psycopg.connect(URL) as c:
        return {str(r[0]): r[1] for r in c.execute('SELECT location_id,quantity FROM accounting.outlet_stock WHERE item_id=%s AND quantity<>0',
                                                     (live.items[name],))}


def adds_up(live):
    with psycopg.connect(URL) as c:
        assert c.execute("""SELECT count(*) FROM catalog_items c WHERE c.business_id=%s AND c.item_type='PRODUCT' AND coalesce(c.stock_quantity,0)
                            <> coalesce((SELECT sum(quantity) FROM accounting.outlet_stock s WHERE s.business_id=c.business_id AND s.item_id=c.id),0)""",
                         (live.business,)).fetchone()[0] == 0


def assign(live, who, location):
    with psycopg.connect(URL) as c:
        c.execute('UPDATE memberships SET all_locations=false,location_id=%s WHERE business_id=%s AND user_id=%s', (location, live.business, live.people[who]))


def shift(live, who, location=None):
    data = ShiftOpen(request_key=uuid4(), opening_float='0', location_id=location)
    return call(live, who, lambda s, a: start(s, a, data))


def test_stock_is_held_per_outlet_and_a_till_sells_only_what_its_outlet_holds(live):
    beans, rice = stock(live, 'Beans')[0], stock(live, 'Rice')[0]
    ikeja = outlet(live, 'Ikeja shop')
    assert split(live, 'Beans') == {ikeja: beans} and split(live, 'Rice') == {ikeja: rice}  # the first outlet takes everything
    yaba = outlet(live, 'Yaba shop')
    with pytest.raises(HTTPException, match='Choose the outlet receiving the goods'):
        got(live, supplier_id=live.ids['supplier'], lines=[('Beans', 10, '1300')])
    receipt, _ = got(live, supplier_id=live.ids['supplier'], location_id=yaba, lines=[('Beans', 10, '1300')])
    assert (receipt['outlet'], receipt['location_id']) == ('Yaba shop', yaba)
    assert split(live, 'Beans') == {ikeja: beans, yaba: 10} and stock(live, 'Beans')[0] == beans + 10

    as_template(live, 'editor', 'cashier')
    status = call(live, 'editor', lambda s, a: current(s, a))
    assert [o['name'] for o in status['outlets']] == ['Ikeja shop', 'Yaba shop'] and status['own_outlet'] is None
    with pytest.raises(HTTPException, match='Choose the outlet this till is in'):
        shift(live, 'editor')
    assert shift(live, 'editor', yaba)['outlet'] == 'Yaba shop'
    with pytest.raises(HTTPException, match='Only 10 x Beans at Yaba shop'):
        sold(live, 'editor', lines=(('Beans', 11, '0'),))
    sale_id = sold(live, 'editor', lines=(('Beans', 4, '0'),))
    sold(live, 'owner', lines=(('Beans', 1, '0'),))  # no shift, all outlets: the main outlet
    assert split(live, 'Beans') == {ikeja: beans - 1, yaba: 6}
    with psycopg.connect(URL) as c:
        assert str(c.execute('SELECT location_id FROM accounting.stock_event WHERE source_id=%s', (sale_id,)).fetchone()[0]) == yaba
    refund(live, 'owner', sale_id, 2)
    assert split(live, 'Beans') == {ikeja: beans - 1, yaba: 8}  # back where the sale came from

    assign(live, 'admin', ikeja)
    with pytest.raises(HTTPException, match='You work at Ikeja shop'):
        shift(live, 'admin', yaba)
    assert shift(live, 'admin')['outlet'] == 'Ikeja shop'
    assert call(live, 'admin', lambda s, a: current(s, a))['own_outlet'] == ikeja

    # A change that names no outlet (a stock count) lands on the main outlet; any excess comes from the others.
    got(live, supplier_id=live.ids['supplier'], location_id=yaba, lines=[('Rice', 3, '50000')])
    call(live, 'owner', lambda s, a: request_adjustment(s, a, adjustment(live, -(rice + 1), 'Rice', 'Count after the move')))
    assert split(live, 'Rice') == {yaba: 2}
    view = call(live, 'viewer', lambda s, a: by_outlet(s))
    assert [o['name'] for o in view['outlets']] == ['Ikeja shop', 'Yaba shop']
    assert next(i for i in view['items'] if i['name'] == 'Rice') == {'id': str(live.items['Rice']), 'name': 'Rice', 'total': 2,
                                                                      'outlets': {ikeja: 0, yaba: 2}, 'in_transit': 0}
    adds_up(live)
    books_balance(live)


def test_returns_leave_from_the_receiving_outlet_and_businesses_without_outlets_are_unchanged(live):
    receipt, _ = got(live, supplier_id=live.ids['supplier'], lines=[('Beans', 5, '1300')])  # no outlets yet: business-wide
    assert receipt['location_id'] is None and split(live, 'Beans') == {}
    with pytest.raises(HTTPException, match='no outlets yet'):
        got(live, supplier_id=live.ids['supplier'], location_id=uuid4(), lines=[('Beans', 1, '1300')])
    ikeja = outlet(live, 'Ikeja shop'); yaba = outlet(live, 'Yaba shop')
    receipt, _ = got(live, supplier_id=live.ids['supplier'], location_id=yaba, lines=[('Beans', 5, '1300')])
    assert shift(live, 'owner', yaba)['outlet'] == 'Yaba shop'
    sold(live, 'owner', lines=(('Beans', 4, '0'),))
    back = lambda q: call(live, 'owner', lambda s, a: return_goods(s, a, receipt['id'], SupplierReturn(
        request_key=uuid4(), reason='Damaged tins', lines=[{'item_id': live.items['Beans'], 'quantity': q}])))
    with pytest.raises(HTTPException, match='Only 1 of that product left at Yaba shop to return'):
        back(3)
    back(1)
    assert split(live, 'Beans').get(yaba) is None and split(live, 'Beans')[ikeja] == stock(live, 'Beans')[0]
    with pytest.raises(HTTPException, match='Choose one of your open outlets'):
        got(live, supplier_id=live.ids['supplier'], location_id=uuid4(), lines=[('Beans', 1, '1300')])
    adds_up(live)
    books_balance(live)
