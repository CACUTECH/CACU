"""Permission model, part 4 (Doc 08 §5–§7): templates chosen when inviting or for an existing member, custom profiles,
and no handing out more than you hold."""
import json
from pathlib import Path
from uuid import uuid4
import psycopg
import pytest
from test_management_postgres import managed, write, read, URL  # noqa: F401  (fixtures)
from test_library_postgres import database  # noqa: F401

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
MIGRATIONS = Path(__file__).resolve().parents[2] / 'supabase/migrations'
PARTS = ['20261106110000_permissions_sales_invoices_expenses.sql', '20261106120000_permissions_ledger_hr_settings_billing.sql',
         '20261106130000_permission_templates_on_screen.sql']


@pytest.fixture
def team(managed):
    d = managed
    with psycopg.connect(URL) as c:
        for name in PARTS:
            c.execute((MIGRATIONS / name).read_text(encoding='utf-8'))
    people = {}
    with psycopg.connect(URL) as c:
        for role in ('admin', 'editor'):
            people[role] = uuid4()
            c.execute('INSERT INTO auth.users VALUES(%s,%s,now())', (people[role], f'{role}@example.com'))
            c.execute('INSERT INTO memberships(business_id,user_id,role) VALUES(%s,%s,%s)', (d[1], people[role], role))
    return d, people


def call(d, actor, sql, *args):
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE authenticated')
        c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': str(actor)}),))
        return c.execute(sql, args).fetchone()[0]


def template_id(code):
    with psycopg.connect(URL) as c:
        return c.execute('SELECT id FROM authz.role_templates WHERE code=%s AND business_id IS NULL', (code,)).fetchone()[0]


def membership(d, person):
    with psycopg.connect(URL) as c:
        return c.execute("""SELECT m.role::text, t.code, m.all_locations FROM memberships m JOIN authz.role_templates t ON t.id=m.role_template_id
                            WHERE m.business_id=%s AND m.user_id=%s""", (d[1], person)).fetchone()


def can(d, person, permission):
    return call(d, person, 'SELECT authz.has_permission(%s,%s)', d[1], permission)


def test_the_screen_lists_every_template_with_what_it_allows(team):
    d, _ = team
    listed = call(d, d[2], 'SELECT public.role_templates(%s)', d[1])
    by_code = {t['code']: t for t in listed['templates']}
    assert listed['custom_allowed'] is True and 'owner' in by_code and by_code['editor_legacy']['legacy'] is True
    assert by_code['cashier']['permissions'] == sorted(['sales.view', 'sales.create', 'sales.edit', 'sales.post', 'invoices.view', 'invoices.create',
                                                         'invoices.post', 'customers.view', 'customers.create', 'inventory.view',
                                                         'services.view', 'services.create'])
    assert {code: by_code[code]['role'] for code in ('cashier', 'auditor', 'accountant', 'editor_legacy', 'admin_legacy')} == \
        {'cashier': 'editor', 'auditor': 'viewer', 'accountant': 'admin', 'editor_legacy': 'editor', 'admin_legacy': 'admin'}


def test_an_invitation_carries_its_template_to_the_new_member(team):
    d, _ = team
    invited = call(d, d[2], 'SELECT public.invite_member(%s,%s,%s)', d[1], uuid4(),
                   json.dumps({'email': 'till@example.com', 'name': 'Till', 'template_id': str(template_id('cashier'))}))
    assert invited['role'] == 'editor'
    newcomer = uuid4()
    with psycopg.connect(URL) as c:
        c.execute('INSERT INTO auth.users VALUES(%s,%s,now())', (newcomer, 'till@example.com'))
    assert call(d, newcomer, 'SELECT public.accept_business_invitation(%s)', invited['id']) == d[1]
    assert membership(d, newcomer)[:2] == ('editor', 'cashier')
    assert can(d, newcomer, 'sales.post') and not can(d, newcomer, 'expenses.create')


def test_a_template_is_kept_and_the_old_role_check_never_widens_it(team):
    d, people = team
    call(d, d[2], 'SELECT public.assign_role_template(%s,%s,%s)', d[1], people['editor'], template_id('accountant'))
    assert membership(d, people['editor']) == ('admin', 'accountant', True)  # the role that covers ledger approval
    assert can(d, people['editor'], 'ledger.approve') and not can(d, people['editor'], 'settings.edit')
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match='PERMISSION_DENIED settings'):  # admin role, but no staff rights
        write(d, 'location.save', {'name': 'Second shop'}, actor=people['editor'])
    with psycopg.connect(URL) as c:  # unrelated changes keep the chosen template
        c.execute('UPDATE memberships SET display_name=%s WHERE user_id=%s', ('Ngozi', people['editor']))
    assert membership(d, people['editor'])[1] == 'accountant'


def test_nobody_hands_out_more_than_they_hold_or_changes_the_owner_or_themselves(team):
    d, people = team
    call(d, d[2], 'SELECT public.assign_role_template(%s,%s,%s)', d[1], people['admin'], template_id('admin'))  # Doc 08 Admin: ledger view only
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match='TEMPLATE_EXCEEDS_YOUR_ACCESS'):
        call(d, people['admin'], 'SELECT public.assign_role_template(%s,%s,%s)', d[1], people['editor'], template_id('bookkeeper'))
    assert call(d, people['admin'], 'SELECT public.assign_role_template(%s,%s,%s)', d[1], people['editor'], template_id('cashier'))
    for target, template, refusal in ((d[2], 'cashier', 'OWNER_PERMISSION_REQUIRED'), (people['admin'], 'cashier', 'CANNOT_CHANGE_OWN_ACCESS'),
                                      (people['editor'], 'owner', 'TEMPLATE_INVALID')):
        with pytest.raises(psycopg.Error, match=refusal):
            call(d, people['admin'], 'SELECT public.assign_role_template(%s,%s,%s)', d[1], target, template_id(template))


def test_custom_profiles_are_saved_assigned_updated_and_deleted_only_when_unused(team):
    d, people = team
    with pytest.raises(psycopg.Error, match='INVALID_PERMISSIONS'):  # billing stays with the Owner
        call(d, d[2], 'SELECT public.save_role_template(%s,%s,%s,%s)', d[1], None, 'Store keeper', ['inventory.view', 'billing.edit'])
    profile = call(d, d[2], 'SELECT public.save_role_template(%s,%s,%s,%s)', d[1], None, 'Store keeper', ['inventory.view', 'inventory.create'])
    assert profile['role'] == 'editor'
    call(d, d[2], 'SELECT public.assign_role_template(%s,%s,%s)', d[1], people['editor'], profile['id'])
    assert can(d, people['editor'], 'inventory.create') and not can(d, people['editor'], 'sales.post')
    call(d, d[2], 'SELECT public.save_role_template(%s,%s,%s,%s)', d[1], profile['id'], 'Store keeper', ['inventory.view', 'inventory.approve'])
    assert membership(d, people['editor'])[0] == 'admin' and can(d, people['editor'], 'inventory.approve')  # rights follow at once
    with pytest.raises(psycopg.Error, match='DUPLICATE_TEMPLATE_NAME'):
        call(d, d[2], 'SELECT public.save_role_template(%s,%s,%s,%s)', d[1], None, 'cashier', ['sales.view'])
    with pytest.raises(psycopg.Error, match='TEMPLATE_IN_USE'):
        call(d, d[2], 'SELECT public.delete_role_template(%s,%s)', d[1], profile['id'])
    call(d, d[2], 'SELECT public.assign_role_template(%s,%s,%s)', d[1], people['editor'], template_id('cashier'))
    call(d, d[2], 'SELECT public.delete_role_template(%s,%s)', d[1], profile['id'])
    assert profile['id'] not in {t['id'] for t in call(d, d[2], 'SELECT public.role_templates(%s)', d[1])['templates']}
