"""Customer tags, segments and lifetime value (Doc 10 CRM; Doc 18 R3 "E06 segments"): rules on spend, recency, what
is owed and tags, all of which must hold; lifetime value (invoiced less credit notes) on Chairman, or before billing."""
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.crm import Rules, SegmentSave, Tags, delete_segment, export, members, overview, save_segment, set_tags
from cacu.accounting.workflows import InvoiceCreate, invoice_create
from test_corrections_postgres import live, call, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_activation_postgres import TODAY

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


def names(result):
    return [c['name'] for c in result['customers']]


@pytest.fixture
def shop(live):
    """Ada owes ₦60,000 from the opening position and buys ₦3,000 today; Bisi has never bought."""
    with psycopg.connect(URL) as c:
        found = dict(c.execute('SELECT id, name FROM customers WHERE id = ANY(%s)', ([live.ids['ada'], live.ids['bisi']],)).fetchall())
    live.customer_names = {k: found[v] for k, v in (('ada', live.ids['ada']), ('bisi', live.ids['bisi']))}
    call(live, 'owner', lambda s, a: invoice_create(s, a, InvoiceCreate(request_key=uuid4(), customer_id=live.ids['ada'], invoice_number='INV-SEG-1',
         entry_date=TODAY, items=[{'catalog_item_id': live.items['Beans'], 'quantity': 2, 'unit_price': '1500.00'}])))
    return live


def test_tags_are_tidied_and_segments_pick_customers_by_every_rule(shop):
    live, ada, bisi = shop, shop.customer_names['ada'], shop.customer_names['bisi']
    tagged = call(live, 'editor', lambda s, a: set_tags(s, a, live.ids['ada'], Tags(tags=['Wholesale', '  wholesale ', 'Church'])))
    assert tagged['tags'] == ['church', 'wholesale']
    with pytest.raises(HTTPException, match='1 to 30 characters'):
        call(live, 'editor', lambda s, a: set_tags(s, a, live.ids['ada'], Tags(tags=['x' * 31])))
    rule = lambda **kw: call(live, 'viewer', lambda s, a: members(s, Rules(**kw)))
    assert names(rule(spent_at_least={'amount': '2000', 'days': 90})) == [ada]
    assert names(rule(spent_at_least={'amount': '5000', 'days': 90})) == []
    assert bisi in names(rule(no_purchase_for={'days': 60})) and ada not in names(rule(no_purchase_for={'days': 60}))  # never bought counts
    assert names(rule(bought_within={'days': 7})) == [ada]
    assert names(rule(owes_at_least='50000')) == [ada]
    assert names(rule(tags_any=['CHURCH'])) == [ada]
    assert names(rule(tags_any=['church'], spent_less_than={'amount': '1000', 'days': 30})) == []  # every rule must hold
    found = rule(tags_any=['church'])['customers'][0]
    assert (found['owes'], found['spent_90_days'], found['days_since'], found['lifetime_value']) == ('63000.00', '3000.00', 0, '3000.00')
    with pytest.raises(ValueError, match='at least one rule'):
        Rules()


def test_segments_are_saved_counted_exported_and_deleted(shop):
    live, ada = shop, shop.customer_names['ada']
    big = SegmentSave(id=uuid4(), name='Big buyers', rules=Rules(spent_at_least={'amount': '2000', 'days': 90}))
    saved = call(live, 'editor', lambda s, a: save_segment(s, a, big))
    assert saved['name'] == 'Big buyers' and names(saved) == [ada]
    with pytest.raises(HTTPException, match='already exists'):
        call(live, 'editor', lambda s, a: save_segment(s, a, SegmentSave(id=uuid4(), name='big BUYERS', rules=Rules(owes_at_least='1'))))
    call(live, 'editor', lambda s, a: save_segment(s, a, SegmentSave(id=uuid4(), name='Quiet', rules=Rules(no_purchase_for={'days': 60}))))
    view = call(live, 'viewer', lambda s, a: overview(s))
    assert {s['name']: s['customers'] for s in view['segments']}['Big buyers'] == 1 and view['lifetime_value']
    text = call(live, 'viewer', lambda s, a: export(s, big.id))
    assert text.splitlines()[0] == 'Name,Phone,Tags,Owes,Last purchase,Spent in 90 days,Lifetime value' and ada in text.splitlines()[1]
    remaining = call(live, 'editor', lambda s, a: delete_segment(s, big.id))
    assert [s['name'] for s in remaining['segments']] == ['Quiet']


def test_lifetime_value_is_a_chairman_feature_once_billing_starts(shop):
    live = shop
    with psycopg.connect(URL) as c:
        c.execute("SELECT set_config('platform.actor_kind','system',true),set_config('platform.reason','Segments test',true)")
        c.execute("INSERT INTO platform.subscriptions(business_id,plan_code,status) VALUES(%s,'GROW','active') ON CONFLICT (business_id) DO UPDATE SET plan_code='GROW'", (live.business,))
    result = call(live, 'viewer', lambda s, a: members(s, Rules(owes_at_least='1')))
    assert not result['lifetime_value'] and 'lifetime_value' not in result['customers'][0]
    with psycopg.connect(URL) as c:
        c.execute("SELECT set_config('platform.actor_kind','system',true),set_config('platform.reason','Segments test',true)")
        c.execute("UPDATE platform.subscriptions SET plan_code='TOP' WHERE business_id=%s", (live.business,))
    assert call(live, 'viewer', lambda s, a: members(s, Rules(owes_at_least='1')))['lifetime_value']
