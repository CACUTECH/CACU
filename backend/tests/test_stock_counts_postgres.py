"""Stock counts (Doc 18 R3 "E09 counts"; Doc 09 PR-20 and month-end step 4): counted by anyone with stock permission,
approved once by an Owner or Admin who did not submit it; approval posts every difference to Inventory adjustments and
write-offs; sales made while counting are allowed for; an approved count answers the month-end step."""
from decimal import Decimal
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.counts import CountDecision, CountSave, CountStart, approve, listing, reject, save, start, submit
from cacu.accounting.periods import checklist, month_start
from cacu.accounting.workflows import sale_create
from test_corrections_postgres import live, call, balance, stock, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_activation_postgres import TODAY
from test_pos_checkout_postgres import sale

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


def counted(live, **quantities):
    return CountSave(lines=[{'item_id': live.items[name], 'counted': q} for name, q in quantities.items()])


def test_a_count_is_approved_once_by_someone_else_and_posts_the_differences(live):
    begun = call(live, 'editor', lambda s, a: start(s, a, CountStart(request_key=uuid4(), name='November count')))
    lines = {l['name']: l for l in begun['lines']}
    assert begun['status'] == 'counting' and lines['Beans']['expected'] == 3 and lines['Rice']['expected'] == 10
    with pytest.raises(HTTPException, match='already open'):
        call(live, 'owner', lambda s, a: start(s, a, CountStart(request_key=uuid4(), name='Another')))
    with pytest.raises(HTTPException, match='at least one counted'):
        call(live, 'editor', lambda s, a: submit(s, a, begun['id']))
    call(live, 'editor', lambda s, a: save(s, a, begun['id'], counted(live, Beans=2, Rice=10)))  # one tin of beans missing
    sent = call(live, 'editor', lambda s, a: submit(s, a, begun['id']))
    assert sent['summary'] == {'items': 3, 'counted': 2, 'differences': 1}  # the third product was not counted, so it is left as it is
    with pytest.raises(HTTPException, match='no longer be changed'):
        call(live, 'editor', lambda s, a: save(s, a, begun['id'], counted(live, Beans=3)))
    with pytest.raises(HTTPException, match='owner or an Admin'):
        call(live, 'editor', lambda s, a: approve(s, a, begun['id'], CountDecision()))
    inventory, write_offs = balance(live, '1200'), balance(live, '5100')
    done = call(live, 'owner', lambda s, a: approve(s, a, begun['id'], CountDecision(note='Checked the shelf')))
    assert done['status'] == 'approved' and {l['name']: l['posted'] for l in done['lines']} == {'Beans': True, 'Rice': False, 'Short': False}
    assert stock(live, 'Beans')[0] == 2 and stock(live, 'Rice')[0] == 10
    assert balance(live, '5100') - write_offs == Decimal('1200.50') and balance(live, '1200') - inventory == Decimal('-1200.50')
    with psycopg.connect(URL) as c:
        assert c.execute("SELECT reason, status FROM accounting.stock_adjustment WHERE business_id=%s AND item_id=%s",
                         (live.business, live.items['Beans'])).fetchone() == ('Stock count: November count', 'posted')
    steps = {s['key']: s for s in call(live, 'owner', lambda s, a: checklist(s, month_start(TODAY)))}
    assert steps['stock_count']['passed'] and 'Stock count approved on' in steps['stock_count']['detail']
    assert [c['status'] for c in call(live, 'viewer', lambda s, a: listing(s))] == ['approved']


def test_the_submitter_cannot_approve_and_a_rejected_count_is_counted_again(live):
    begun = call(live, 'owner', lambda s, a: start(s, a, CountStart(request_key=uuid4(), name='Spot check')))
    call(live, 'owner', lambda s, a: save(s, a, begun['id'], counted(live, Rice=9)))
    call(live, 'owner', lambda s, a: submit(s, a, begun['id']))
    with pytest.raises(HTTPException, match='Someone else must approve'):
        call(live, 'owner', lambda s, a: approve(s, a, begun['id'], CountDecision()))
    with pytest.raises(HTTPException, match='Say why'):
        call(live, 'admin', lambda s, a: reject(s, a, begun['id'], CountDecision()))
    assert call(live, 'admin', lambda s, a: reject(s, a, begun['id'], CountDecision(note='Rice in the back store not counted')))['status'] == 'rejected'
    assert stock(live, 'Rice')[0] == 10  # nothing posted
    again = call(live, 'owner', lambda s, a: start(s, a, CountStart(request_key=uuid4(), name='Spot check again')))
    assert again['status'] == 'counting'


def test_sales_made_while_counting_are_allowed_for(live):
    begun = call(live, 'editor', lambda s, a: start(s, a, CountStart(request_key=uuid4(), name='During trading')))
    call(live, 'owner', lambda s, a: sale_create(s, a, sale(live, lines=(('Beans', 1, '0'),))))  # sold while the count was going on
    call(live, 'editor', lambda s, a: save(s, a, begun['id'], counted(live, Beans=2)))  # what is on the shelf afterwards
    sent = call(live, 'editor', lambda s, a: submit(s, a, begun['id']))
    beans = next(l for l in sent['lines'] if l['name'] == 'Beans')
    assert (beans['expected'], beans['difference']) == (2, 0) and sent['summary']['differences'] == 0
    assert call(live, 'owner', lambda s, a: approve(s, a, begun['id'], CountDecision()))['status'] == 'approved'
    assert stock(live, 'Beans')[0] == 2
