"""Doc 08 GAP-07 / SEC-011: SECURITY DEFINER functions callable by signed-in users, on disposable PostgreSQL fixtures."""
import json
import re
from pathlib import Path
from uuid import uuid4
import psycopg
import pytest
from test_management_postgres import managed, database, URL
from test_legacy_write_boundary_postgres import boundary
from test_legacy_invoice_creation_postgres import invoicing
from test_legacy_access_postgres import legacy_db, DSN

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
MIGRATION = Path('../supabase/migrations/20261030120000_definer_function_access.sql')

# Every function signed-in users may call, with the check that protects it. Production list from the
# read-only advisor on 29 October 2026 plus later migrations; see docs/suite/definer-function-inventory-20261030.md.
REVIEWED = {
    'accept_business_invitation': 'invitation email must match the verified caller',
    'accounting_mode': 'is_business_member',
    'can_read_upload': 'active membership and valid resource',
    'create_invoice_safe': 'has_business_role owner/admin/editor',
    'get_business_kpis': 'is_business_member',
    'get_revenue_trend': 'is_business_member',
    'has_business_role': 'answers only for the caller',
    'hr_history': 'management_private.authorize owner/admin',
    'hr_payroll_defaults': 'no tenant input; returns platform default rules',
    'hr_write': 'management_private.authorize per operation',
    'is_business_member': 'answers only for the caller',
    'legacy_invoice_balances': 'has_business_role any member',
    'management_read': 'management_private.authorize per section',
    'management_write': 'management_private.authorize per operation',
    'process_sale_safe': 'has_business_role owner/admin/editor',
    'record_ledger_entry_safe': 'has_business_role owner/admin/editor',
    'record_payment_atomic': 'has_business_role owner/admin/editor',
    'request_upload_delete': 'owner/admin membership and can_read_upload (active)',
    'reserve_upload': 'active membership with purpose role',
    'update_invoice_status_safe': 'has_business_role owner/admin/editor',
}
NO_TENANT_INPUT = {'hr_payroll_defaults'}
SAMPLE = {'uuid': None, 'text': "'x'", 'jsonb': "'{}'::jsonb", 'date': 'CURRENT_DATE', 'numeric': '1', 'integer': '1',
          'bigint': '1', 'boolean': 'false', 'membership_role[]': "ARRAY['owner']::public.membership_role[]"}


def callable_definers(c):
    return c.execute("""SELECT p.oid::regprocedure::text, p.proname, p.proconfig,
        array(SELECT format_type(t, NULL) FROM unnest(p.proargtypes) t)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prosecdef AND p.prokind = 'f' AND p.prorettype <> 'trigger'::regtype
        AND has_function_privilege('authenticated', p.oid, 'EXECUTE')""").fetchall()


def test_unused_legacy_definers_are_no_longer_callable(legacy_db):
    with psycopg.connect(DSN) as c:
        c.execute(MIGRATION.read_text(encoding='utf-8'))
        for fn in ['record_audit(uuid,text,text,uuid,jsonb)', 'process_sale(uuid,uuid,jsonb,text,numeric)', 'adjust_inventory_stock(uuid,uuid,integer)']:
            for role in ['anon', 'authenticated']:
                assert c.execute('SELECT has_function_privilege(%s,%s,%s)', (role, f'public.{fn}', 'EXECUTE')).fetchone() == (False,), (role, fn)


def test_every_callable_definer_is_reviewed_pinned_and_refuses_other_tenants(invoicing):
    _, legacy, _, people, _ = invoicing
    tables = ['invoices', 'invoice_items', 'financial_transactions', 'audit_logs', 'catalog_items', 'memberships', 'payments']
    # This fixture has only some of the old functions MIGRATION revokes; apply each revoke whose function exists.
    with psycopg.connect(URL) as c:
        for statement in re.findall(r'^REVOKE EXECUTE ON FUNCTION (public\.\w+\([^)]*\)).*;$', MIGRATION.read_text(encoding='utf-8'), re.M):
            if c.execute('SELECT to_regprocedure(%s)', (statement,)).fetchone()[0]:
                c.execute(f'REVOKE EXECUTE ON FUNCTION {statement} FROM PUBLIC, anon, authenticated')
        functions = callable_definers(c)
        before = {t: c.execute(f'SELECT count(*) FROM public.{t}').fetchone()[0] for t in tables}
    checked = []
    for signature, name, config, types in functions:
        assert name in REVIEWED, f'{signature} is callable by signed-in users but has not been reviewed'
        assert any(setting.startswith('search_path=') for setting in config or []), f'{signature} has no fixed search_path'
        if name in NO_TENANT_INPUT:
            continue
        first_uuid = True
        args = []
        for t in types:
            if t == 'uuid':
                args.append(f"'{legacy if first_uuid else uuid4()}'::uuid")
                first_uuid = False
            else:
                args.append(SAMPLE[t])
        with psycopg.connect(URL) as c:
            c.execute('SET ROLE authenticated')
            c.execute("SELECT set_config('request.jwt.claims',%s,false)", (json.dumps({'sub': str(people['outsider'])}),))
            checked.append(name)
            try:
                result = c.execute(f'SELECT public.{name}({",".join(args)})').fetchall()
            except psycopg.Error as error:
                # A missing table, column or function means a broken fixture, not a refusal.
                assert error.sqlstate not in {'42P01', '42703', '42883'}, f'{signature}: {error}'
                continue
        assert all(row[0] in (None, False, [], {}) for row in result), f'{signature} returned data to another tenant: {result}'
    assert len(checked) >= 10, checked
    with psycopg.connect(URL) as c:
        assert {t: c.execute(f'SELECT count(*) FROM public.{t}').fetchone()[0] for t in tables} == before
