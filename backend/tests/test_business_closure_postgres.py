"""Closing a business (Doc 10 E22 part 3, FR-210): only the Owner, typing the business's name; read-only at once, staff
out, billing stopped; reopened within 90 days with the staff back; after 90 days contact details and operational data
removed while the books stay, read-only, for the Owner."""
import json
from uuid import uuid4
import psycopg
import pytest
from test_corrections_postgres import live, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


def as_user(live, who, sql, args=()):
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE authenticated')
        c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': str(live.people[who]), 'role': 'authenticated', 'aal': 'aal1'}),))
        return c.execute(sql, args).fetchone()[0]


def name(live):
    with psycopg.connect(URL) as c:
        return c.execute('SELECT name FROM businesses WHERE id=%s', (live.business,)).fetchone()[0]


def close(live, who='owner', confirm=None, reason='Moving to a new shop'):
    return as_user(live, who, 'SELECT public.close_business(%s,%s,%s)', (live.business, confirm if confirm is not None else name(live), reason))


def scalar(sql, args=()):
    with psycopg.connect(URL) as c:
        return c.execute(sql, args).fetchone()[0]


def active(live):
    with psycopg.connect(URL) as c:
        return {r[0] for r in c.execute('SELECT user_id FROM memberships WHERE business_id=%s AND is_active', (live.business,))}


@pytest.fixture
def billed(live):
    with psycopg.connect(URL) as c:
        c.execute("SELECT set_config('platform.actor_kind','system',true),set_config('platform.reason','Closure test',true)")
        c.execute("""INSERT INTO platform.subscriptions(business_id,plan_code,status) VALUES(%s,'GROW','active')
                     ON CONFLICT (business_id) DO UPDATE SET status='active'""", (live.business,))
    return live


def test_only_the_owner_closes_and_the_business_goes_read_only_with_staff_out(billed):
    live = billed
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match='ACCESS_DENIED'):
        close(live, 'admin')
    with pytest.raises(psycopg.errors.InvalidParameterValue, match='CONFIRM_NAME_MISMATCH'):
        close(live, confirm='Some other shop')
    with pytest.raises(psycopg.errors.InvalidParameterValue, match='REASON_REQUIRED'):
        close(live, reason=' ')
    staff = active(live) - {live.people['owner']}
    assert staff and scalar('SELECT platform.writes_allowed(%s)', (live.business,))
    status = close(live, confirm='  ' + name(live).upper() + ' ')  # the name, typed loosely
    assert status['closed'] and status['can_reopen'] and status['staff'] == 0
    assert active(live) == {live.people['owner']}  # the Owner keeps read-only access to export or reopen
    assert not scalar('SELECT platform.writes_allowed(%s)', (live.business,)) and scalar('SELECT platform.is_closed(%s)', (live.business,))
    assert scalar('SELECT status FROM platform.subscriptions WHERE business_id=%s', (live.business,)) == 'closed'  # no renewals
    with psycopg.connect(URL) as c, pytest.raises(psycopg.errors.RaiseException, match='BUSINESS_CLOSED'):
        c.execute("INSERT INTO customers(id,business_id,name) VALUES(%s,%s,'New buyer')", (uuid4(), live.business))
    assert as_user(live, 'editor', 'SELECT public.business_closure_status(%s)', (live.business,)) is None  # staff are out
    with pytest.raises(psycopg.errors.CheckViolation, match='ALREADY_CLOSED'):
        close(live)
    assert scalar("SELECT count(*) FROM platform.business_closure_events WHERE business_id=%s AND event='closed'", (live.business,)) == 1


def test_the_owner_reopens_within_90_days_and_the_staff_come_back(billed):
    live = billed
    before = active(live)
    close(live)
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match='ACCESS_DENIED'):
        as_user(live, 'admin', 'SELECT public.reopen_business(%s)', (live.business,))  # no longer a member
    reopened = as_user(live, 'owner', 'SELECT public.reopen_business(%s)', (live.business,))
    assert not reopened['closed'] and reopened['staff_restored'] == len(before) - 1
    assert active(live) == before and scalar('SELECT platform.writes_allowed(%s)', (live.business,))
    assert scalar('SELECT status FROM platform.subscriptions WHERE business_id=%s', (live.business,)) == 'active'
    with pytest.raises(psycopg.errors.CheckViolation, match='NOT_CLOSED'):
        as_user(live, 'owner', 'SELECT public.reopen_business(%s)', (live.business,))
    assert close(live)['closed']  # it can be closed again


def test_after_90_days_contact_details_and_operational_data_go_and_the_books_stay(live):
    with psycopg.connect(URL) as c:  # the contact columns production has (the test schema's customers are reduced)
        c.execute('ALTER TABLE customers ADD COLUMN IF NOT EXISTS email text, ADD COLUMN IF NOT EXISTS phone_number text, ADD COLUMN IF NOT EXISTS address text')
        c.execute("UPDATE customers SET email='ada@example.com', phone_number='08030000000', address='12 Market Road' WHERE business_id=%s", (live.business,))
        c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': str(live.people['owner'])}),))
        c.execute("""INSERT INTO parked_sales(business_id,label,items,created_by) VALUES(%s,'Held','[{"item":1}]',%s)""", (live.business, live.people['owner']))
        names = sorted(r[0] for r in c.execute('SELECT name FROM customers WHERE business_id=%s', (live.business,)))
        ledger = c.execute('SELECT count(*) FROM accounting.ledger WHERE business_id=%s', (live.business,)).fetchone()[0]
    close(live)
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT platform.closures_due()').fetchone()[0] == 0  # not before the 90 days
        c.execute("UPDATE platform.business_closure SET purge_after=now()-interval '1 minute' WHERE business_id=%s", (live.business,))
    with pytest.raises(psycopg.errors.CheckViolation, match='REOPEN_WINDOW_ENDED'):
        as_user(live, 'owner', 'SELECT public.reopen_business(%s)', (live.business,))
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE cacu_runtime')
        assert c.execute('SELECT platform.closures_due()').fetchone()[0] == 1
        assert c.execute('SELECT platform.purge_closed_businesses()').fetchone()[0] == 1
    with psycopg.connect(URL) as c:
        contact = c.execute('SELECT count(*) FROM customers WHERE business_id=%s AND (email IS NOT NULL OR phone_number IS NOT NULL OR address IS NOT NULL)',
                            (live.business,)).fetchone()[0]
        assert contact == 0
        assert sorted(r[0] for r in c.execute('SELECT name FROM customers WHERE business_id=%s', (live.business,))) == names  # on the invoices
        assert c.execute('SELECT count(*) FROM parked_sales WHERE business_id=%s', (live.business,)).fetchone()[0] == 0
        assert c.execute('SELECT count(*) FROM accounting.ledger WHERE business_id=%s', (live.business,)).fetchone()[0] == ledger  # R-FIN stays
        status, purged = c.execute('SELECT status, purged_at IS NOT NULL FROM platform.business_closure WHERE business_id=%s', (live.business,)).fetchone()
        assert (status, purged) == ('purged', True)
        details = c.execute("SELECT details FROM platform.business_closure_events WHERE business_id=%s AND event='purged'", (live.business,)).fetchone()[0]
        assert details['customers_cleared'] >= 1 and details['public.parked_sales'] == 1
        with pytest.raises(psycopg.errors.RaiseException, match='BUSINESS_CLOSED'):  # still read-only, for good
            c.execute("UPDATE customers SET email='back@example.com' WHERE business_id=%s", (live.business,))
    assert live.people['owner'] in active(live)  # the Owner can still read the retained books
    with pytest.raises(psycopg.errors.CheckViolation, match='NOT_CLOSED'):
        as_user(live, 'owner', 'SELECT public.reopen_business(%s)', (live.business,))
    with psycopg.connect(URL) as c:  # browsers cannot run the removal or read the closure records
        c.execute('SET LOCAL ROLE authenticated')
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            c.execute('SELECT platform.purge_closed_businesses()')
