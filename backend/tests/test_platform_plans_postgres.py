"""Plans, entitlements and subscriptions (Doc 14, M-09 part 1) on a disposable PostgreSQL database."""
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4
import psycopg
import pytest

URL = os.getenv('CACU_TEST_DATABASE_URL')
pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
MIGRATION = Path(__file__).resolve().parents[2] / 'supabase/migrations/20261102100000_platform_plans.sql'


@pytest.fixture(autouse=True)
def database():
    parsed = urlparse(URL)
    assert parsed.hostname in {'127.0.0.1', 'localhost'} and parsed.path.endswith('_test')
    with psycopg.connect(URL) as c:
        c.execute("""DROP SCHEMA IF EXISTS platform CASCADE; DROP SCHEMA IF EXISTS accounting CASCADE; DROP SCHEMA IF EXISTS auth CASCADE;
          DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE SCHEMA auth;
          DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; END $$;
          DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; END $$;
          CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
          CREATE TABLE public.businesses(id uuid PRIMARY KEY, name text, business_type text NOT NULL);
          CREATE TABLE public.memberships(business_id uuid, user_id uuid, role text, is_active boolean NOT NULL DEFAULT true);
          GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
          GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
          -- Mirror hosted Supabase: members may update their business row (mode changes go through it).
          GRANT SELECT, UPDATE ON public.businesses TO authenticated;""")
        c.execute(MIGRATION.read_text(encoding='utf-8'))
        c.execute((MIGRATION.parent / '20261104130000_plan_limit_values.sql').read_text(encoding='utf-8'))
    yield


def business(mode='PRODUCT', plan=None, status='active'):
    ident, owner = uuid4(), uuid4()
    with psycopg.connect(URL) as c:
        c.execute('INSERT INTO businesses VALUES(%s,%s,%s)', (ident, 'Ada Provisions', mode))
        c.execute("INSERT INTO memberships VALUES(%s,%s,'owner',true)", (ident, owner))
        if plan:
            subscribe(c, ident, plan, status)
    return ident, owner


def subscribe(c, ident, plan, status='active', reason='Paid through checkout'):
    c.execute("SELECT set_config('platform.actor_kind','system',true), set_config('platform.reason',%s,true)", (reason,))
    c.execute('INSERT INTO platform.subscriptions(business_id,plan_code,status) VALUES(%s,%s,%s)', (ident, plan, status))


def change(ident, reason='Owner chose a new plan', **values):
    with psycopg.connect(URL) as c:
        c.execute("SELECT set_config('platform.actor_kind','owner',true), set_config('platform.reason',%s,true)", (reason,))
        sets = ', '.join(f'{k}=%s' for k in values)
        c.execute(f'UPDATE platform.subscriptions SET {sets} WHERE business_id=%s', (*values.values(), ident))


def as_member(actor, sql, args=()):
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE authenticated')
        c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': str(actor)}),))
        cursor = c.execute(sql, args)
        return cursor.fetchall() if cursor.description else None


def entitlement(ident, key):
    with psycopg.connect(URL) as c:
        return c.execute('SELECT platform.entitlement(%s,%s)', (ident, key)).fetchone()[0]


def test_three_paid_plans_with_owner_approved_prices_and_hybrid_on_chairman_only():
    with psycopg.connect(URL) as c:
        plans = c.execute('SELECT code,display_name,monthly_price_kobo,annual_price_kobo FROM platform.plans ORDER BY rank').fetchall()
        modes = dict(c.execute("SELECT plan_code,value FROM platform.plan_entitlements WHERE key='module.modes'").fetchall())
    assert plans == [('BASE', 'General', 150000, None), ('GROW', 'Oga', 600000, None), ('TOP', 'Chairman', 1500000, None)]
    assert {code for code, value in modes.items() if 'HYBRID' in value} == {'TOP'}


def test_unbilled_business_keeps_todays_behaviour():
    ident, owner = business()
    assert entitlement(ident, 'module.modes') is None
    as_member(owner, "UPDATE businesses SET business_type='HYBRID' WHERE id=%s", (ident,))
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT business_type, platform.writes_allowed(id) FROM businesses WHERE id=%s', (ident,)).fetchone() == ('HYBRID', True)


@pytest.mark.parametrize('plan', ['BASE', 'GROW'])
def test_hybrid_mode_is_refused_below_chairman_even_through_the_data_api(plan):
    ident, owner = business(plan=plan)
    with pytest.raises(psycopg.errors.RaiseException, match='PLAN_LIMIT module.modes'):
        as_member(owner, "UPDATE businesses SET business_type='HYBRID' WHERE id=%s", (ident,))
    as_member(owner, "UPDATE businesses SET business_type='SERVICE' WHERE id=%s", (ident,))
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT business_type FROM businesses WHERE id=%s', (ident,)).fetchone()[0] == 'SERVICE'


def test_chairman_allows_hybrid_and_a_downgrade_needs_another_mode_first():
    ident, owner = business(plan='TOP')
    as_member(owner, "UPDATE businesses SET business_type='HYBRID' WHERE id=%s", (ident,))
    with pytest.raises(psycopg.errors.RaiseException, match='PLAN_LIMIT module.modes'):
        change(ident, plan_code='GROW')
    as_member(owner, "UPDATE businesses SET business_type='PRODUCT' WHERE id=%s", (ident,))
    change(ident, plan_code='GROW')
    assert entitlement(ident, 'users.max') == 5


def test_a_hybrid_business_cannot_start_on_a_plan_without_hybrid():
    ident, _ = business('HYBRID')
    with psycopg.connect(URL) as c:
        with pytest.raises(psycopg.errors.RaiseException, match='PLAN_LIMIT module.modes'):
            subscribe(c, ident, 'GROW')


def test_entitlement_values_unlimited_and_missing_keys():
    ident, _ = business(plan='TOP')
    # JSON null (unlimited) and SQL NULL (unbilled) both read as None in Python, so compare in SQL.
    with psycopg.connect(URL) as c:
        unlimited, missing = c.execute("SELECT platform.entitlement(%s,'catalog.max_items') = 'null'::jsonb, platform.entitlement(%s,'module.unknown')", (ident, ident)).fetchone()
    assert unlimited is True and missing is False


@pytest.mark.parametrize('status,allowed', [('trialing', True), ('incomplete', True), ('active', True), ('past_due', True),
                                            ('grace', True), ('suspended', False), ('cancelled', False), ('closed', False)])
def test_read_only_states(status, allowed):
    ident, _ = business(plan='BASE', status=status)
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT platform.writes_allowed(%s)', (ident,)).fetchone()[0] is allowed


def test_every_subscription_change_is_explained_and_history_is_kept():
    ident, owner = business(plan='BASE')
    with pytest.raises(psycopg.errors.InvalidParameterValue, match='SUBSCRIPTION_REASON_REQUIRED'):
        with psycopg.connect(URL) as c:
            c.execute("UPDATE platform.subscriptions SET status='grace' WHERE business_id=%s", (ident,))
    change(ident, reason='Card declined at renewal', status='grace')
    with psycopg.connect(URL) as c:
        rows = c.execute('SELECT from_plan,to_plan,from_status,to_status,actor_kind,reason FROM platform.subscription_changes WHERE business_id=%s ORDER BY id', (ident,)).fetchall()
        assert c.execute('SELECT version FROM platform.subscriptions WHERE business_id=%s', (ident,)).fetchone()[0] == 2
    assert rows == [(None, 'BASE', None, 'active', 'system', 'Paid through checkout'),
                    ('BASE', 'BASE', 'active', 'grace', 'owner', 'Card declined at renewal')]
    for sql in ('DELETE FROM platform.subscription_changes', 'DELETE FROM platform.subscriptions',
                "UPDATE platform.subscription_changes SET reason='edited'"):
        with pytest.raises(psycopg.errors.InsufficientPrivilege, match='PLATFORM_HISTORY_IS_KEPT'):
            with psycopg.connect(URL) as c:
                c.execute(sql)


def test_limit_changes_are_audited():
    with psycopg.connect(URL) as c:
        c.execute("UPDATE platform.plan_entitlements SET value='8' WHERE plan_code='GROW' AND key='users.max'")
        row = c.execute("SELECT table_name,row_key,old_value->'value',new_value->'value' FROM platform.config_changes ORDER BY id DESC LIMIT 1").fetchone()
    assert row == ('plan_entitlements', {'plan_code': 'GROW', 'key': 'users.max'}, 5, 8)


def test_members_read_their_own_plan_and_nothing_else():
    ident, owner = business(plan='GROW')
    other, outsider = business(plan='TOP')
    plan = as_member(owner, 'SELECT public.business_plan(%s)', (ident,))[0][0]
    assert (plan['plan'], plan['plan_name'], plan['status'], plan['writes_allowed'], plan['entitlements']['users.max']) == ('GROW', 'Oga', 'active', True, 5)
    names = [p['name'] for p in as_member(owner, 'SELECT public.billing_plans()')[0][0]]
    assert names == ['General', 'Oga', 'Chairman']
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_member(outsider, 'SELECT public.business_plan(%s)', (ident,))
    with psycopg.connect(URL) as c:
        c.execute('UPDATE memberships SET is_active=false WHERE user_id=%s', (owner,))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_member(owner, 'SELECT public.business_plan(%s)', (ident,))
    for sql in ('SELECT * FROM platform.subscriptions', 'SELECT platform.entitlement(%s,%s)'):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            as_member(outsider, sql, (other, 'users.max') if '%s' in sql else ())
    with psycopg.connect(URL) as c:
        for table in ('plans', 'plan_entitlements', 'subscriptions', 'subscription_changes', 'config_changes'):
            for privilege in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'):
                assert not c.execute('SELECT has_table_privilege(%s,%s,%s)', ('authenticated', 'platform.' + table, privilege)).fetchone()[0]


def test_owner_confirmed_limits_and_every_change_is_logged():
    with psycopg.connect(URL) as c:
        rows = c.execute("""SELECT key, jsonb_object_agg(plan_code, value) FROM platform.plan_entitlements
                             WHERE key IN ('users.max','outlets.max','catalog.max_items','ai.queries_per_month') GROUP BY key""").fetchall()
        logged = c.execute("SELECT count(*) FROM platform.config_changes WHERE table_name='plan_entitlements' AND old_value IS NOT NULL").fetchone()[0]
    assert dict(rows) == {'users.max': {'BASE': 2, 'GROW': 5, 'TOP': 50}, 'outlets.max': {'BASE': 1, 'GROW': 5, 'TOP': 20},
                          'catalog.max_items': {'BASE': 300, 'GROW': 3000, 'TOP': None}, 'ai.queries_per_month': {'BASE': 30, 'GROW': 100, 'TOP': None}}
    assert logged == 5  # AI for General and Chairman, outlets for Oga and Chairman, users for Chairman
