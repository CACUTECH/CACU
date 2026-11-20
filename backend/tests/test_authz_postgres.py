"""Permission model foundation (Doc 08 §5–§6, M-07) on a disposable PostgreSQL database."""
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4
import psycopg
import pytest

URL = os.getenv('CACU_TEST_DATABASE_URL')
pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
MIGRATIONS = Path(__file__).resolve().parents[2] / 'supabase/migrations'
ACTIONS = {'V': 'view', 'C': 'create', 'E': 'edit', 'A': 'approve', 'P': 'post', 'X': 'export', 'D': 'delete'}
MODULES = ['sales', 'invoices', 'customers', 'inventory', 'services', 'expenses', 'ledger', 'banking', 'hr', 'settings', 'billing']

# Doc 08 §5, restated here so a typo in the seed fails the build. Columns follow MODULES; '-' is no access.
DOC_08 = {
    'owner':             ['VCEAPXD'] * 11,
    'admin':             ['VCEAPXD', 'VCEAPXD', 'VCEXD', 'VCEAPXD', 'VCEAPXD', 'VCEAPX', 'VX', 'VCEAP', 'VCEAX', 'VCED', 'V'],
    'accountant':        ['VX', 'VAPX', 'VX', 'VX', 'V', 'VAPX', 'VCEAPX', 'VCEAPX', 'V', 'V', '-'],
    'bookkeeper':        ['VC', 'VCE', 'VCE', 'VC', 'V', 'VCE', 'VCE', 'VCE', '-', '-', '-'],
    'sales_manager':     ['VCEAP', 'VCEP', 'VCEX', 'V', 'VCE', 'VC', 'V', '-', '-', '-', '-'],
    'cashier':           ['VCP', 'VCP', 'VC', 'V', 'VC', '-', '-', '-', '-', '-', '-'],
    'inventory_manager': ['V', '-', '-', 'VCEAPX', '-', 'VC', 'V', '-', '-', '-', '-'],
    'hr_manager':        ['-', '-', '-', '-', '-', 'VC', '-', '-', 'VCEAPX', 'V', '-'],
    'service_staff':     ['VCP', 'VC', 'VC', 'V', 'VCE', 'VC', '-', '-', 'V', '-', '-'],
    'auditor':           ['V', 'V', 'V', 'V', 'V', 'V', 'VX', 'V', 'V', 'V', '-'],
    'editor_legacy':     ['VCEP', 'VCEPD', 'VCE', 'VCE', 'VCE', 'VCEP', 'VCP', 'V', '-', '-', '-'],
    'viewer_legacy':     ['V', 'V', 'V', 'V', 'V', 'V', 'V', 'V', '-', '-', '-'],
}


def expected(template):
    return {f'{module}.{ACTIONS[letter]}' for module, letters in zip(MODULES, DOC_08[template]) if letters != '-' for letter in letters}


@pytest.fixture(autouse=True)
def database():
    parsed = urlparse(URL)
    assert parsed.hostname in {'127.0.0.1', 'localhost'} and parsed.path.endswith('_test')
    with psycopg.connect(URL) as c:
        c.execute("""DROP SCHEMA IF EXISTS authz CASCADE; DROP SCHEMA IF EXISTS platform CASCADE; DROP SCHEMA IF EXISTS accounting CASCADE;
          DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE SCHEMA auth;
          DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated','cacu_runtime'] LOOP
            IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF; END LOOP; END $$;
          CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
          CREATE TABLE public.businesses(id uuid PRIMARY KEY, name text, business_type text NOT NULL DEFAULT 'PRODUCT', created_by uuid);
          CREATE TABLE public.memberships(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, user_id uuid, role text,
            is_active boolean NOT NULL DEFAULT true, all_locations boolean NOT NULL DEFAULT true, location_id uuid);
          GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, cacu_runtime;
          GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, cacu_runtime;""")
        c.execute((MIGRATIONS / '20261102100000_platform_plans.sql').read_text(encoding='utf-8'))
        # Members who exist before the migration, as in production.
        c.execute("INSERT INTO businesses(id,name) VALUES ('00000000-0000-4000-8000-000000000001','Existing')")
        c.execute("""INSERT INTO memberships(business_id,user_id,role) VALUES
          ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000a1','owner'),
          ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000a2','editor')""")
        c.execute((MIGRATIONS / '20261106100000_authz_foundation.sql').read_text(encoding='utf-8'))
    yield


def business(roles=('owner',)):
    ident = uuid4()
    people = {}
    with psycopg.connect(URL) as c:
        c.execute('INSERT INTO businesses(id,name) VALUES(%s,%s)', (ident, 'Ada Provisions'))
        for role in roles:
            people[role] = uuid4()
            c.execute('INSERT INTO memberships(business_id,user_id,role) VALUES(%s,%s,%s)', (ident, people[role], role))
    return ident, people


def assign(ident, person, template):
    with psycopg.connect(URL) as c:
        c.execute("""UPDATE memberships SET role_template_id=(SELECT id FROM authz.role_templates WHERE code=%s AND business_id IS NULL)
                     WHERE business_id=%s AND user_id=%s""", (template, ident, person))


def can(actor, ident, permission, location=None):
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE authenticated')
        c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': str(actor)}) if actor else '',))
        return c.execute('SELECT authz.has_permission(%s,%s,%s)', (ident, permission, location)).fetchone()[0]


def template_permissions():
    with psycopg.connect(URL) as c:
        rows = c.execute("""SELECT t.code, p.permission_code FROM authz.role_templates t
                            JOIN authz.role_template_permissions p ON p.template_id = t.id WHERE t.business_id IS NULL""").fetchall()
    result = {}
    for code, permission in rows:
        result.setdefault(code, set()).add(permission)
    return result


def test_the_catalogue_has_seven_actions_on_eleven_modules_and_twelve_built_in_templates():
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT count(*), count(DISTINCT module), count(DISTINCT action) FROM authz.permissions').fetchone() == (77, 11, 7)
        names = dict(c.execute('SELECT code, name FROM authz.role_templates WHERE business_id IS NULL').fetchall())
    assert set(names) == set(DOC_08) and names['editor_legacy'] == 'Editor (legacy)' and names['sales_manager'] == 'Sales manager'


@pytest.mark.parametrize('template', sorted(DOC_08))
def test_each_built_in_template_holds_exactly_the_doc_08_permissions(template):
    assert template_permissions().get(template, set()) == expected(template)


def test_existing_members_keep_their_access_and_new_or_changed_roles_follow_the_role():
    with psycopg.connect(URL) as c:
        mapped = dict(c.execute("""SELECT m.role, t.code FROM memberships m JOIN authz.role_templates t ON t.id = m.role_template_id
                                   WHERE m.business_id='00000000-0000-4000-8000-000000000001'""").fetchall())
    assert mapped == {'owner': 'owner', 'editor': 'editor_legacy'}
    ident, people = business(('owner', 'admin', 'viewer'))
    with psycopg.connect(URL) as c:
        c.execute("UPDATE memberships SET role='editor' WHERE user_id=%s", (people['viewer'],))
        rows = dict(c.execute("""SELECT m.user_id, t.code FROM memberships m JOIN authz.role_templates t ON t.id=m.role_template_id
                                 WHERE m.business_id=%s""", (ident,)).fetchall())
    assert rows == {people['owner']: 'owner', people['admin']: 'admin', people['viewer']: 'editor_legacy'}


def test_owners_hold_everything_and_a_cashier_only_the_till():
    ident, people = business(('owner', 'editor'))
    assign(ident, people['editor'], 'cashier')
    assert all(can(people['owner'], ident, f'{m}.{a}') for m in MODULES for a in ACTIONS.values())
    assert [can(people['editor'], ident, p) for p in ('sales.post', 'invoices.create', 'ledger.view', 'inventory.approve', 'billing.view')] == \
        [True, True, False, False, False]


def test_nobody_outside_or_inactive_or_signed_out_gets_anything():
    ident, people = business(('owner', 'admin'))
    other, _ = business()
    assert can(people['admin'], other, 'sales.view') is False  # member of another business
    assert can(None, ident, 'sales.view') is False  # signed out
    with psycopg.connect(URL) as c:
        c.execute('UPDATE memberships SET is_active=false WHERE user_id=%s', (people['admin'],))
    assert can(people['admin'], ident, 'sales.view') is False  # takes effect on the next request (SEC-006)
    with pytest.raises(psycopg.errors.InvalidParameterValue, match='UNKNOWN_PERMISSION'):
        can(people['owner'], ident, 'sales.refund')


def test_overrides_add_or_remove_one_permission_and_a_revoke_wins():
    ident, people = business(('owner', 'editor'))
    assign(ident, people['editor'], 'cashier')
    with psycopg.connect(URL) as c:
        c.execute("INSERT INTO authz.membership_overrides VALUES(%s,%s,'ledger.view','grant'), (%s,%s,'sales.post','revoke')",
                  (ident, people['editor'], ident, people['editor']))
    assert (can(people['editor'], ident, 'ledger.view'), can(people['editor'], ident, 'sales.post')) == (True, False)


def test_a_member_limited_to_one_outlet_is_refused_elsewhere():
    ident, people = business(('owner', 'editor'))
    shop, other_shop = uuid4(), uuid4()
    assign(ident, people['editor'], 'cashier')
    with psycopg.connect(URL) as c:
        c.execute('UPDATE memberships SET all_locations=false, location_id=%s WHERE user_id=%s', (shop, people['editor']))
    assert [can(people['editor'], ident, 'sales.post', loc) for loc in (shop, other_shop, None)] == [True, False, True]
    assert can(people['owner'], ident, 'sales.post', other_shop) is True  # owners cover every outlet


def test_hr_needs_a_plan_with_staff_records():
    ident, people = business(('owner', 'editor'))
    assign(ident, people['editor'], 'hr_manager')
    assert can(people['editor'], ident, 'hr.view') is True  # unbilled: unchanged
    with psycopg.connect(URL) as c:
        c.execute("SELECT set_config('platform.actor_kind','system',true), set_config('platform.reason','authz test',true)")
        c.execute("INSERT INTO platform.subscriptions(business_id,plan_code,status) VALUES(%s,'BASE','active')", (ident,))
    assert (can(people['editor'], ident, 'hr.view'), can(people['owner'], ident, 'hr.view')) == (False, False)  # General has no HR
    assert can(people['editor'], ident, 'expenses.create') is True


def test_signed_in_users_and_the_runtime_call_the_decision_but_cannot_read_or_write_the_tables():
    with psycopg.connect(URL) as c:
        for role in ('authenticated', 'cacu_runtime'):
            assert c.execute("SELECT has_function_privilege(%s, 'authz.has_permission(uuid,text,uuid)', 'EXECUTE')", (role,)).fetchone()[0]
            for table in ('permissions', 'role_templates', 'role_template_permissions', 'membership_overrides'):
                for privilege in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'):
                    assert not c.execute('SELECT has_table_privilege(%s,%s,%s)', (role, f'authz.{table}', privilege)).fetchone()[0]
        assert not c.execute("SELECT has_function_privilege('anon', 'authz.has_permission(uuid,text,uuid)', 'EXECUTE')").fetchone()[0]


def test_part_2_adds_the_permission_to_row_security_policies_and_keeps_the_old_rule():
    ident, people = business(('owner', 'editor', 'viewer'))
    with psycopg.connect(URL) as c:
        # Production-style policies: members may insert, owners and editors may update.
        c.execute("""CREATE TABLE public.customers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, name text);
          ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
          GRANT SELECT, INSERT, UPDATE ON public.customers TO authenticated;
          CREATE POLICY customers_select ON public.customers FOR SELECT TO authenticated USING (true);
          CREATE FUNCTION public.writer(b uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
            SELECT EXISTS (SELECT FROM public.memberships WHERE business_id = b AND user_id = auth.uid() AND is_active AND role <> 'viewer') $$;
          GRANT EXECUTE ON FUNCTION public.writer(uuid) TO authenticated;
          CREATE POLICY customers_insert ON public.customers FOR INSERT TO authenticated WITH CHECK (public.writer(business_id));""")
        c.execute((MIGRATIONS / '20261106110000_permissions_sales_invoices_expenses.sql').read_text(encoding='utf-8'))
        rule = c.execute("SELECT with_check FROM pg_policies WHERE policyname='customers_insert'").fetchone()[0]
    assert 'writer(business_id)' in rule and "has_permission(business_id, 'customers.create'" in rule

    def insert(actor):
        with psycopg.connect(URL) as c:
            c.execute('SET LOCAL ROLE authenticated')
            c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': str(actor)}),))
            c.execute('INSERT INTO public.customers(business_id,name) VALUES(%s,%s)', (ident, 'Mama Ngozi'))
    insert(people['editor'])
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        insert(people['viewer'])  # the old rule still applies
    with psycopg.connect(URL) as c:
        c.execute("INSERT INTO authz.membership_overrides VALUES(%s,%s,'customers.create','revoke')", (ident, people['editor']))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        insert(people['editor'])  # and so does the permission
