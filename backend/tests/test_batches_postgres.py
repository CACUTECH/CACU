"""Batches and expiry dates (Doc 18 R3 "E09 counts and batches", part 2): a product marked "track batches" gets a batch
and expiry date on each goods receipt; stock leaving comes from the batch expiring first, unexpired before expired;
a write-off or a supplier return takes the batch it names; what expires within 30 days or has expired is listed."""
from datetime import timedelta
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.batches import BatchTracking, BatchWriteOff, overview, set_tracking, write_off
from cacu.accounting.purchasing import GoodsReceive, SupplierReturn, receive, return_goods
from cacu.accounting.workflows import sale_create
from test_corrections_postgres import live, call, stock, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_activation_postgres import TODAY
from test_pos_checkout_postgres import sale

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


@pytest.fixture
def batched(live):
    """Beans track batches. The management fixture re-creates stock adjustments after the migrations: add the batch column back."""
    migration = open('../supabase/migrations/20261125090000_batches.sql', encoding='utf-8').read()
    with psycopg.connect(URL) as c:
        c.execute(migration[migration.index('-- batch columns begin'):migration.index('-- batch columns end')])
    call(live, 'owner', lambda s, a: set_tracking(s, a, BatchTracking(item_id=live.items['Beans'], track=True)))
    return live


def receive_beans(live, quantity, expiry, batch_no):
    data = GoodsReceive(request_key=uuid4(), supplier_id=live.ids['supplier'],
                        lines=[{'item_id': live.items['Beans'], 'quantity': quantity, 'unit_cost': '1200.50', 'batch_no': batch_no, 'expiry': expiry}])
    return call(live, 'owner', lambda s, a: receive(s, a, data))


def beans(live):
    items = {i['name']: i for i in call(live, 'viewer', lambda s, a: overview(s))['items']}
    return {(b['batch_no'] or '-'): b['quantity'] for b in items['Beans']['batches']}


def test_receipts_add_batches_and_sales_take_the_earliest_expiry_first(batched):
    live = batched
    assert beans(live) == {'-': 3}  # what was on the shelf when tracking began: no batch recorded
    with pytest.raises(HTTPException, match='expiry date'):
        receive_beans(live, 5, None, 'B-1')
    with pytest.raises(HTTPException, match='already past their expiry'):
        receive_beans(live, 5, TODAY - timedelta(days=1), 'B-0')
    receive_beans(live, 5, TODAY + timedelta(days=200), 'LATE')
    receive_beans(live, 4, TODAY + timedelta(days=20), 'SOON')
    assert beans(live) == {'SOON': 4, 'LATE': 5, '-': 3} and stock(live, 'Beans')[0] == 12
    call(live, 'owner', lambda s, a: sale_create(s, a, sale(live, lines=(('Beans', 6, '0'),))))
    assert beans(live) == {'LATE': 3, '-': 3}  # SOON first, then the next to expire; stock with no date last
    view = call(live, 'viewer', lambda s, a: overview(s))
    assert view['attention'] == []  # nothing expiring left on the shelf
    with pytest.raises(HTTPException, match='Turn on batch tracking'):
        call(live, 'owner', lambda s, a: receive(s, a, GoodsReceive(request_key=uuid4(), supplier_id=live.ids['supplier'],
             lines=[{'item_id': live.items['Rice'], 'quantity': 1, 'unit_cost': '50000', 'expiry': TODAY + timedelta(days=9)}])))


def test_expired_stock_is_listed_sold_last_and_written_off_by_batch(batched):
    live = batched
    receive_beans(live, 4, TODAY + timedelta(days=10), 'SOON')
    with psycopg.connect(URL) as c:  # time passes: the batch is now past its date
        c.execute("UPDATE accounting.stock_batch SET expiry=%s WHERE business_id=%s AND batch_no='SOON'", (TODAY - timedelta(days=2), live.business))
    receive_beans(live, 2, TODAY + timedelta(days=25), 'NEXT')
    view = call(live, 'viewer', lambda s, a: overview(s))
    assert [(b['batch_no'], b['state']) for b in view['attention']] == [('SOON', 'expired'), ('NEXT', 'soon')]
    call(live, 'owner', lambda s, a: sale_create(s, a, sale(live, lines=(('Beans', 3, '0'),))))
    assert beans(live) == {'SOON': 4, '-': 2}  # the unexpired batch and undated stock go before the expired batch
    expired = next(b for b in view['attention'] if b['batch_no'] == 'SOON')
    with pytest.raises(HTTPException, match='only 4 left'):
        call(live, 'owner', lambda s, a: write_off(s, a, expired['id'], BatchWriteOff(request_key=uuid4(), quantity=5, reason='Expired')))
    done = call(live, 'owner', lambda s, a: write_off(s, a, expired['id'], BatchWriteOff(request_key=uuid4(), quantity=4, reason='Expired on the shelf')))
    assert done['adjustment']['status'] == 'posted' and 'batch SOON' in done['adjustment']['reason']
    assert beans(live) == {'-': 2} and stock(live, 'Beans')[0] == 2


def test_a_supplier_return_takes_back_the_batch_that_was_received(batched):
    live = batched
    receive_beans(live, 4, TODAY + timedelta(days=10), 'SOON')
    later = receive_beans(live, 5, TODAY + timedelta(days=300), 'LATE')
    call(live, 'owner', lambda s, a: return_goods(s, a, later['id'], SupplierReturn(request_key=uuid4(), reason='Wrong brand',
         lines=[{'item_id': live.items['Beans'], 'quantity': 5}])))
    assert beans(live) == {'SOON': 4, '-': 3}  # the LATE batch went back, not the one expiring first
    call(live, 'owner', lambda s, a: set_tracking(s, a, BatchTracking(item_id=live.items['Beans'], track=False)))
    assert call(live, 'viewer', lambda s, a: overview(s))['items'][0]['batches'] == [] and stock(live, 'Beans')[0] == 7
    with pytest.raises(HTTPException, match='owner or an Admin'):
        call(live, 'editor', lambda s, a: set_tracking(s, a, BatchTracking(item_id=live.items['Beans'], track=True)))
