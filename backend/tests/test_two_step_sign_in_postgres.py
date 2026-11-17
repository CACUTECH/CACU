"""Two-step sign-in (Doc 16 SEC-014, Doc 10 E22 part 1): someone with an authenticator, or an Owner or Admin on the
Chairman plan, gets nothing from the business until the session has passed the second step (aal2). Enforced by the
shared membership checks (row-level security and business functions) and by the accounting API. Recovery codes are
stored hashed, work once, and are rate limited; the API's server jobs ('system') are exempt only from the runtime."""
import json
from uuid import uuid4
import psycopg
import pytest
from cacu.accounting.session import claims
from cacu.auth.session import session_level, token_level
from test_corrections_postgres import live, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


@pytest.fixture
def factors(live):
    """Supabase Auth's factor table, as far as these checks read it."""
    with psycopg.connect(URL) as c:
        c.execute("""CREATE TABLE IF NOT EXISTS auth.mfa_factors(id uuid PRIMARY KEY, user_id uuid NOT NULL, status text NOT NULL,
                     factor_type text NOT NULL DEFAULT 'totp'); TRUNCATE auth.mfa_factors""")
    return live


def enrol(live, who, status='verified'):
    with psycopg.connect(URL) as c:
        c.execute('INSERT INTO auth.mfa_factors(id,user_id,status) VALUES(%s,%s,%s)', (uuid4(), live.people[who], status))


def plan(live, code):
    with psycopg.connect(URL) as c:
        c.execute("SELECT set_config('platform.actor_kind','system',true),set_config('platform.reason','Two-step test',true)")
        c.execute('''INSERT INTO platform.subscriptions(business_id,plan_code,status) VALUES(%s,%s,'active')
                     ON CONFLICT (business_id) DO UPDATE SET plan_code=EXCLUDED.plan_code''', (live.business, code))


def as_user(live, who, sql, args=(), level='aal1', login=None):
    """Run sql as a signed-in browser session (role authenticated) with the given assurance level."""
    with psycopg.connect(URL, **(login or {})) as c:
        c.execute('SET LOCAL ROLE authenticated')
        c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': str(live.people[who]), 'role': 'authenticated', 'aal': level}),))
        return c.execute(sql, args).fetchone()[0]


def can_sell(live, who, level='aal1'):
    return as_user(live, who, "SELECT authz.has_permission(%s,'sales.view')", (live.business,), level)


def test_an_authenticator_must_be_used_once_set_up(factors):
    live = factors
    assert can_sell(live, 'owner')
    enrol(live, 'owner', status='unverified')  # an abandoned setup changes nothing
    assert can_sell(live, 'owner')
    enrol(live, 'owner')
    assert not can_sell(live, 'owner')
    assert can_sell(live, 'owner', 'aal2') and can_sell(live, 'editor')  # others are not affected
    # Blocked people still see their own memberships, so the app can send them to the second step.
    # (The test schema replaces auth and the membership helpers after migrations, so this is checked in the migration
    # here and in production after it is applied.)
    migration = open('../supabase/migrations/20261116090000_two_step_sign_in.sql', encoding='utf-8').read()
    assert 'CREATE POLICY memberships_select_self ON public.memberships FOR SELECT TO authenticated USING (user_id = auth.uid());' in migration
    status = as_user(live, 'owner', 'SELECT public.mfa_status(%s)', (live.business,))
    assert status == {'enrolled': True, 'required': False, 'level': 'aal1', 'satisfied': False, 'recovery_codes_left': 0}


def test_owners_and_admins_on_chairman_must_set_it_up(factors):
    live = factors
    plan(live, 'TOP')
    assert not can_sell(live, 'owner') and not can_sell(live, 'admin') and can_sell(live, 'editor')
    assert as_user(live, 'admin', 'SELECT public.mfa_status(%s)', (live.business,))['required']
    enrol(live, 'admin')
    assert can_sell(live, 'admin', 'aal2') and not can_sell(live, 'admin')
    plan(live, 'GROW')
    assert can_sell(live, 'owner')


def test_only_the_runtime_can_act_as_a_server_job(factors):
    live = factors
    enrol(live, 'owner')
    with psycopg.connect(URL) as c:  # the API's role (cacu_runtime): a pay link or webhook acting for the owner
        c.execute('SET LOCAL ROLE cacu_runtime')
        c.execute("SELECT set_config('request.jwt.claims',%s,true)", (claims(live.people['owner'], 'system'),))
        assert c.execute('SELECT authz.mfa_ok(%s)', (live.business,)).fetchone()[0]
    probe, secret = f'cacu_browser_probe_{uuid4().hex[:8]}', uuid4().hex  # CI's server requires a password
    with psycopg.connect(URL) as c:
        c.execute(f"CREATE ROLE {probe} LOGIN PASSWORD '{secret}'; GRANT authenticated TO {probe}")
    try:  # a browser session cannot claim to be a server job
        assert not as_user(live, 'owner', 'SELECT authz.mfa_ok(%s)', (live.business,), level='system',
                           login={'user': probe, 'password': secret})
    finally:
        with psycopg.connect(URL) as c:
            c.execute(f'DROP OWNED BY {probe}; DROP ROLE {probe}')
    # The API passes the request's own level unless a server job says otherwise.
    token = session_level.set('aal2')
    try:
        assert json.loads(claims(live.people['owner']))['aal'] == 'aal2'
    finally:
        session_level.reset(token)
    assert json.loads(claims(live.people['owner']))['aal'] == 'aal1'


def test_recovery_codes_are_hashed_single_use_and_rate_limited(factors):
    live = factors
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match='MFA_REQUIRED'):
        as_user(live, 'owner', 'SELECT public.new_recovery_codes()', level='aal2')  # no authenticator yet
    enrol(live, 'owner')
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match='MFA_REQUIRED'):
        as_user(live, 'owner', 'SELECT public.new_recovery_codes()')  # only right after the second step
    codes = as_user(live, 'owner', 'SELECT public.new_recovery_codes()', level='aal2')
    assert len(codes) == len(set(codes)) == 10 and all(len(c) == 11 and c[5] == '-' for c in codes)
    with psycopg.connect(URL) as c:
        stored = [r[0] for r in c.execute('SELECT code_hash FROM security_private.recovery_code WHERE user_id=%s', (live.people['owner'],))]
    assert len(stored) == 10 and not set(stored) & {c.replace('-', '') for c in codes}  # only hashes are kept
    assert as_user(live, 'owner', 'SELECT public.mfa_status(%s)', (live.business,), 'aal2')['recovery_codes_left'] == 10
    with pytest.raises(psycopg.errors.InsufficientPrivilege):  # browsers cannot read them
        as_user(live, 'owner', 'SELECT count(*) FROM security_private.recovery_code')

    assert not as_user(live, 'owner', 'SELECT public.use_recovery_code(%s)', ('AAAAA-AAAAA',))
    assert as_user(live, 'owner', 'SELECT public.use_recovery_code(%s)', (codes[0].lower().replace('-', ' '),))  # typed loosely
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT count(*) FROM auth.mfa_factors WHERE user_id=%s', (live.people['owner'],)).fetchone()[0] == 0
    assert can_sell(live, 'owner')  # the lost authenticator is gone; the person sets up a new one
    assert not as_user(live, 'owner', 'SELECT public.use_recovery_code(%s)', (codes[0],))  # once only
    for _ in range(3):  # five failures an hour, per person
        assert not as_user(live, 'owner', 'SELECT public.use_recovery_code(%s)', ('BBBBB-BBBBB',))
    with pytest.raises(psycopg.errors.ProgramLimitExceeded, match='TOO_MANY_ATTEMPTS'):
        as_user(live, 'owner', 'SELECT public.use_recovery_code(%s)', (codes[1],))
    assert not as_user(live, 'admin', 'SELECT public.use_recovery_code(%s)', ('BBBBB-BBBBB',))  # others are not locked


def test_the_accounting_api_refuses_a_session_that_owes_the_second_step(factors):
    from cacu.accounting import session as accounting_session
    live = factors
    enrol(live, 'owner')
    with psycopg.connect(URL) as c:  # what library_transaction checks after the membership check
        c.execute('SET LOCAL ROLE cacu_runtime')
        c.execute("SELECT set_config('request.jwt.claims',%s,true),set_config('cacu.business_id',%s,true)", (claims(live.people['owner']), str(live.business)))
        assert not c.execute('SELECT authz.mfa_ok(%s)', (live.business,)).fetchone()[0]
        c.execute("SELECT set_config('request.jwt.claims',%s,true)", (claims(live.people['owner'], 'aal2'),))
        assert c.execute('SELECT authz.mfa_ok(%s)', (live.business,)).fetchone()[0]
    assert accounting_session.MFA_MESSAGE.startswith('Finish two-step sign-in')


def test_the_token_level_is_read_only_from_its_claims():
    import base64

    def token(payload):
        part = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip('=')
        return f'header.{part}.signature'
    assert token_level(token({'aal': 'aal2', 'sub': 'x'})) == 'aal2'
    assert token_level(token({'aal': 'aal1'})) == 'aal1'
    assert token_level(token({'aal': 'system'})) == 'aal1'  # never from a browser token
    assert token_level('not-a-token') == 'aal1' and token_level(token(['aal2'])) == 'aal1'
