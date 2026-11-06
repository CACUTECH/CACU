"""Permission model, part 3 (Doc 08 §8, M-08): HR, settings reads, ledger set-up and reports also require
authz.has_permission. Existing admins move to Admin (legacy) and keep what they could do."""
import json
from pathlib import Path
from uuid import uuid4
import psycopg
import pytest
from test_hr_workflows_postgres import hr, hire, write, query, member, URL  # noqa: F401  (fixtures)
from test_management_postgres import managed, read  # noqa: F401
from test_permissions_switch_postgres import api, assign  # noqa: F401
from test_library_postgres import database  # noqa: F401

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
MIGRATIONS = Path(__file__).resolve().parents[2] / 'supabase/migrations'
PART2 = MIGRATIONS / '20261106110000_permissions_sales_invoices_expenses.sql'
PART3 = MIGRATIONS / '20261106120000_permissions_ledger_hr_settings_billing.sql'


def switch():
    with psycopg.connect(URL) as c:
        c.execute(PART2.read_text(encoding='utf-8'))
        c.execute(PART3.read_text(encoding='utf-8'))


@pytest.fixture
def staffed(hr):
    d, _ = hr
    admin = member(d, 'admin')
    switch()
    return d, admin


def template_of(business, person):
    with psycopg.connect(URL) as c:
        return c.execute("""SELECT t.code FROM memberships m JOIN authz.role_templates t ON t.id=m.role_template_id
                            WHERE m.business_id=%s AND m.user_id=%s""", (business, person)).fetchone()[0]


def test_existing_and_new_admins_are_on_admin_legacy_and_keep_ledger_rights(staffed):
    d, admin = staffed
    later = member(d, 'admin')
    assert template_of(d[1], admin) == template_of(d[1], later) == 'admin_legacy'
    with psycopg.connect(URL) as c:
        rights = {r[0] for r in c.execute("""SELECT p.permission_code FROM authz.role_template_permissions p
            JOIN authz.role_templates t ON t.id=p.template_id WHERE t.code='admin_legacy'""")}
        doc08 = {r[0] for r in c.execute("""SELECT p.permission_code FROM authz.role_template_permissions p
            JOIN authz.role_templates t ON t.id=p.template_id WHERE t.code='admin'""")}
    assert rights - doc08 == {'ledger.create', 'ledger.edit', 'ledger.approve', 'ledger.post', 'billing.post'}
    assert doc08 <= rights and 'billing.edit' not in rights


def test_running_the_migration_again_changes_nothing(staffed):
    switch()
    with psycopg.connect(URL) as c:
        bodies = c.execute("""SELECT p.proname, pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname IN ('hr_write','hr_history','management_read')""").fetchall()
        templates = c.execute("SELECT count(*) FROM authz.role_templates WHERE code='admin_legacy'").fetchone()[0]
    assert len(bodies) == 3 and all(body.count('authz.require') == 1 for _, body in bodies) and templates == 1


def test_admins_keep_hr_and_templates_decide_who_else_may(staffed):
    d, admin = staffed
    hired = write(d, 'employee.save', {'full_name': 'Bisi Ade', 'job_title': 'Cashier'}, actor=admin)
    assert hired['id'] and hired['replayed'] is False
    assign(d[1], admin, 'accountant')  # HR view only: reads, cannot hire
    assert query(d, 'SELECT count(*) FROM employees', actor=admin)[0][0] >= 1
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match='PERMISSION_DENIED hr.create'):
        write(d, 'employee.save', {'full_name': 'Chika Eze'}, actor=admin)
    assign(d[1], admin, 'cashier')  # no HR at all: the rows are not visible either
    assert query(d, 'SELECT count(*) FROM employees', actor=admin)[0][0] == 0
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match='PERMISSION_DENIED hr.view'):
        query(d, 'SELECT public.hr_history(%s,%s)', (d[1], hired['id']), actor=admin)
    assign(d[1], admin, 'hr_manager')
    assert write(d, 'employee.save', {'full_name': 'Chika Eze'}, actor=admin)['id']


def test_settings_reads_need_settings_view_and_the_catalogue_needs_inventory_view(staffed):
    d, admin = staffed
    assert read(d, 'users', actor=admin)['data']
    assign(d[1], admin, 'cashier')
    assert 'data' in read(d, 'catalog', actor=admin)
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match='PERMISSION_DENIED settings.view'):
        read(d, 'users', actor=admin)


def test_reports_and_ledger_lists_ask_for_ledger_view(api):
    d, staff, client = api
    base = f'/api/v1/businesses/{d[1]}'
    detail = lambda response: str(response.json().get('detail', ''))
    window = {'start_date': f'{d[6]}-01-01', 'end_date': f'{d[6]}-12-31'}
    assert 'permission' not in detail(client.get(f'{base}/reports/summary', params=window))  # Editor (legacy) reads reports
    assign(d[1], staff, 'cashier')
    for path, params in (('reports/summary', window), ('reports/trial-balance', {'as_of': f'{d[6]}-12-31'}), ('journals', {}), ('expenses', {})):
        refused = client.get(f'{base}/{path}', params=params)
        assert refused.status_code == 403 and 'You do not have permission' in detail(refused), path
