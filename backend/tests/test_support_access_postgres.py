"""Support access (Doc 10 E22 part 4, FR-212; Doc 08 THR-08; Doc 16 T-12): no standing access for CACU staff. The Owner
grants it for one case, 1 hour to 7 days, and can end it early; a listed support person, after the second step, opens
the case (recorded) and can then read, never write; staff and pay records only when the Owner ticked them."""
import json
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy.pool import NullPool
from cacu.accounting import session as sessions
from cacu.auth.session import session_level
from test_corrections_postgres import live, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


def as_user(live, who, sql, args=(), level='aal2'):
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE authenticated')
        c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': str(live.people[who]), 'role': 'authenticated', 'aal': level}),))
        return c.execute(sql, args).fetchone()[0]


def runtime(sql, args=()):
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE cacu_runtime')
        return c.execute(sql, args).fetchone()[0]


def grant(live, hours=24, reason='Stock count looks wrong', pay=False, who='owner'):
    return as_user(live, who, 'SELECT public.grant_support_access(%s,%s,%s,%s)', (live.business, hours, reason, pay))


def can(live, permission, who='outsider', level='aal2'):
    return as_user(live, who, 'SELECT authz.has_permission(%s,%s)', (live.business, permission), level)


@pytest.fixture
def support(live):
    """The outsider is a CACU support person, listed by the operator."""
    # The management fixture re-applies an older migration after all of them; put back the API's checks.
    migration = open('../supabase/migrations/20261119090000_support_access.sql', encoding='utf-8').read()
    with psycopg.connect(URL) as c:
        c.execute(migration[migration.index('-- support api begin'):migration.index('-- support api end')])
    assert runtime('SELECT ops.set_support_staff(%s,%s,true)', (live.people['outsider'], 'Tolu (CACU support)'))['active_staff'] >= 1
    return live


def test_the_owner_grants_a_case_support_opens_it_and_can_only_read(support):
    live = support
    assert as_user(live, 'outsider', 'SELECT public.support_cases()')['cases'] == []  # no standing access
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match='NO_SUPPORT_ACCESS'):
        as_user(live, 'outsider', 'SELECT public.open_support_case(%s)', (live.business,))
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match='ACCESS_DENIED'):
        grant(live, who='admin')  # only the Owner
    with pytest.raises(psycopg.errors.InvalidParameterValue, match='SUPPORT_LENGTH_INVALID'):
        grant(live, hours=500)  # no open-ended window
    with pytest.raises(psycopg.errors.InvalidParameterValue, match='REASON_REQUIRED'):
        grant(live, reason=' ')
    status = grant(live)
    assert status['active']['reason'] == 'Stock count looks wrong' and not status['active']['include_pay']
    with pytest.raises(psycopg.errors.CheckViolation, match='SUPPORT_ALREADY_GRANTED'):
        grant(live)

    assert not as_user(live, 'outsider', 'SELECT public.support_cases()', level='aal1')['two_step']
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match='MFA_REQUIRED'):
        as_user(live, 'outsider', 'SELECT public.open_support_case(%s)', (live.business,), 'aal1')
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match='ACCESS_DENIED'):
        as_user(live, 'editor', 'SELECT public.open_support_case(%s)', (live.business,))  # not CACU support
    cases = as_user(live, 'outsider', 'SELECT public.support_cases()')['cases']
    assert [(c['business_id'], c['opened']) for c in cases] == [(str(live.business), False)]
    assert not can(live, 'sales.view')  # nothing until the case is opened

    as_user(live, 'outsider', 'SELECT public.open_support_case(%s)', (live.business,))
    assert can(live, 'sales.view') and can(live, 'ledger.view')
    assert not can(live, 'sales.create') and not can(live, 'settings.edit') and not can(live, 'ledger.export')  # read-only
    assert not can(live, 'hr.view')  # staff and pay records were not ticked
    assert not can(live, 'sales.view', level='aal1')  # only after the second step
    assert not as_user(live, 'editor', 'SELECT authz.has_permission(%s,%s)', (live.business, 'hr.view'))  # members unaffected

    with psycopg.connect(URL) as c:  # the accounting API's checks name it 'support' and show the business's rows
        c.execute('SET LOCAL ROLE cacu_runtime')
        c.execute("SELECT set_config('request.jwt.claims',%s,true),set_config('cacu.business_id',%s,true)",
                  (sessions.claims(live.people['outsider'], 'aal2'), str(live.business)))
        assert c.execute('SELECT accounting.lock_membership(%s,%s)', (live.business, live.people['outsider'])).fetchone()[0] == 'support'
        assert c.execute('SELECT accounting.authorized(%s)', (live.business,)).fetchone()[0]

    with psycopg.connect(URL) as c:  # no row change in the business, by any route
        c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': str(live.people['outsider']), 'aal': 'aal2'}),))
        with pytest.raises(psycopg.errors.InsufficientPrivilege, match='SUPPORT_READ_ONLY'):
            c.execute("INSERT INTO customers(id,business_id,name) VALUES(%s,%s,'Support was here')", (uuid4(), live.business))
    with psycopg.connect(URL) as c:
        c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': str(live.people['outsider']), 'aal': 'aal2'}),))
        with pytest.raises(psycopg.errors.InsufficientPrivilege, match='SUPPORT_READ_ONLY'):
            c.execute('DELETE FROM customers WHERE business_id=%s', (live.business,))
    with psycopg.connect(URL) as c:  # the business's own people write as before
        c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': str(live.people['owner'])}),))
        c.execute("INSERT INTO customers(id,business_id,name) VALUES(%s,%s,'New buyer')", (uuid4(), live.business))

    history = as_user(live, 'owner', 'SELECT public.support_access_status(%s)', (live.business,))['history']
    assert [(h['event'], h['by']) for h in history] == [('opened', 'Tolu (CACU support)'), ('granted', 'Owner')]
    with pytest.raises(psycopg.errors.InsufficientPrivilege):  # browsers cannot touch the records
        as_user(live, 'owner', 'SELECT count(*) FROM ops.support_event')
    with psycopg.connect(URL) as c, pytest.raises(psycopg.errors.InsufficientPrivilege, match='SUPPORT_EVENTS_APPEND_ONLY'):
        c.execute("UPDATE ops.support_event SET event='granted' WHERE business_id=%s", (live.business,))


def test_pay_only_when_ticked_and_access_ends_when_ended_expired_or_removed(support):
    live = support
    grant(live, hours=1, pay=True)
    as_user(live, 'outsider', 'SELECT public.open_support_case(%s)', (live.business,))
    assert can(live, 'hr.view')
    ended = as_user(live, 'owner', 'SELECT public.end_support_access(%s)', (live.business,))
    assert ended['active'] is None and ended['history'][0]['event'] == 'ended'
    assert not can(live, 'sales.view')  # at once
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match='NO_SUPPORT_ACCESS'):
        as_user(live, 'outsider', 'SELECT public.open_support_case(%s)', (live.business,))
    with pytest.raises(psycopg.errors.CheckViolation, match='NO_SUPPORT_ACCESS'):
        as_user(live, 'owner', 'SELECT public.end_support_access(%s)', (live.business,))

    grant(live, hours=1)
    as_user(live, 'outsider', 'SELECT public.open_support_case(%s)', (live.business,))
    assert can(live, 'sales.view')
    with psycopg.connect(URL) as c:  # the hour passes
        c.execute("""UPDATE ops.support_grant SET granted_at=now()-interval '2 hours', expires_at=now()-interval '1 hour'
                     WHERE business_id=%s AND ended_at IS NULL""", (live.business,))
    assert not can(live, 'sales.view')
    assert as_user(live, 'outsider', 'SELECT public.support_cases()')['cases'] == []

    grant(live, hours=24)
    as_user(live, 'outsider', 'SELECT public.open_support_case(%s)', (live.business,))
    assert can(live, 'sales.view')
    runtime('SELECT ops.set_support_staff(%s,NULL,false)', (live.people['outsider'],))  # left CACU support
    assert not can(live, 'sales.view')
    assert not as_user(live, 'outsider', 'SELECT public.support_cases()')['staff']
    with pytest.raises(psycopg.errors.InsufficientPrivilege):  # browsers cannot list themselves as support
        as_user(live, 'outsider', 'SELECT ops.set_support_staff(%s,%s,true)', (live.people['outsider'], 'Me'))


def test_the_shared_membership_checks_admit_an_opened_case_for_viewing_only(support):
    live = support
    migration = open('../supabase/migrations/20261119090000_support_access.sql', encoding='utf-8').read()
    with psycopg.connect(URL) as c:  # the checks as production has them (this fixture stubs them), then the patch
        c.execute("""CREATE OR REPLACE FUNCTION public.is_business_member(p_business_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
                     'SELECT EXISTS (SELECT 1 FROM public.memberships WHERE business_id = $1 AND user_id = auth.uid() AND is_active)';
                     CREATE OR REPLACE FUNCTION public.has_business_role(p_business_id uuid, p_roles public.membership_role[]) RETURNS boolean
                      LANGUAGE sql STABLE AS 'SELECT EXISTS (SELECT 1 FROM public.memberships WHERE business_id = $1 AND user_id = auth.uid() AND is_active AND role = ANY($2))'""")
        c.execute(migration[migration.index('-- membership patch begin'):migration.index('-- membership patch end')])
    member = lambda who: as_user(live, who, 'SELECT public.is_business_member(%s)', (live.business,))
    role = lambda who, roles: as_user(live, who, 'SELECT public.has_business_role(%s,%s::public.membership_role[])', (live.business, roles))
    assert member('editor') and role('owner', ['owner']) and not role('editor', ['owner', 'admin'])  # members as before
    assert not member('outsider')
    grant(live)
    assert not member('outsider')  # granted but not opened
    as_user(live, 'outsider', 'SELECT public.open_support_case(%s)', (live.business,))
    assert member('outsider') and role('outsider', ['owner', 'admin', 'editor', 'viewer'])
    assert not role('outsider', ['owner', 'admin', 'editor'])  # never where only those who may change things are admitted
    assert not as_user(live, 'outsider', 'SELECT public.is_business_member(%s)', (live.business,), 'aal1')


def test_the_accounting_api_lets_support_read_and_refuses_every_write(support, monkeypatch):
    live = support

    def test_engine(*args, **kwargs):
        engine = create_engine(URL.replace('postgresql://', 'postgresql+psycopg://'), poolclass=NullPool)

        @event.listens_for(engine, 'connect')
        def role(connection, record):
            connection.autocommit = True
            with connection.cursor() as cursor:
                cursor.execute('SET ROLE cacu_runtime')
            connection.autocommit = False
        return engine
    monkeypatch.setenv('CACU_DATABASE_URL', URL)
    monkeypatch.setattr(sessions, 'create_engine', test_engine)
    outsider = live.people['outsider']
    token = session_level.set('aal2')
    try:
        with pytest.raises(HTTPException) as refused:  # no case yet
            with sessions.library_transaction(outsider, live.business):
                pass
        assert refused.value.status_code == 403
        grant(live)
        as_user(live, 'outsider', 'SELECT public.open_support_case(%s)', (live.business,))
        with sessions.library_transaction(outsider, live.business, permission='ledger.view') as session:
            assert session.business_id == live.business
        with pytest.raises(HTTPException) as refused:
            with sessions.library_transaction(outsider, live.business, write=True):
                pass
        assert refused.value.status_code == 403 and refused.value.detail == sessions.SUPPORT_MESSAGE
        with pytest.raises(HTTPException) as refused:  # not even what a read-only workspace may still do
            with sessions.library_transaction(outsider, live.business, write=True, while_read_only=True):
                pass
        assert refused.value.detail == sessions.SUPPORT_MESSAGE
    finally:
        session_level.reset(token)


def test_the_operator_tool_adds_and_removes_support_staff(live, monkeypatch, capsys):
    from contextlib import contextmanager
    from tools import support_staff

    @contextmanager
    def runtime_cursor():
        with psycopg.connect(URL) as c:
            c.execute('SET LOCAL ROLE cacu_runtime')
            with c.cursor() as cursor:
                yield cursor
    monkeypatch.setattr(support_staff, 'platform_transaction', runtime_cursor)
    person = str(live.people['outsider'])
    assert support_staff.main(['add', '--user-id', person, '--name', 'Tolu (CACU support)']) == 0
    assert json.loads(capsys.readouterr().out) == {'action': 'add', 'status': 'ok', 'active_staff': 1}
    assert as_user(live, 'outsider', 'SELECT public.support_cases()')['staff']
    assert support_staff.main(['remove', '--user-id', person]) == 0
    assert json.loads(capsys.readouterr().out)['active_staff'] == 0
    assert not as_user(live, 'outsider', 'SELECT public.support_cases()')['staff']
