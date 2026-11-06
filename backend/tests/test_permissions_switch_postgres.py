"""Permission model, part 2 (Doc 08 §8, M-08): sales, invoices, expenses, catalogue and staff functions require
authz.has_permission as well as the old role check. Built on the legacy invoicing fixture, which has every patched
function, and on the shared library database for the native API."""
import json
import os
from decimal import Decimal
from pathlib import Path
from uuid import uuid4
import psycopg
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.pool import NullPool
from test_legacy_invoice_creation_postgres import invoicing, create, lines  # noqa: F401  (fixtures)
from test_legacy_write_boundary_postgres import boundary, run, entry  # noqa: F401
from test_management_postgres import managed  # noqa: F401
from test_library_postgres import database  # noqa: F401

URL = os.getenv('CACU_TEST_DATABASE_URL')
pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
SWITCH = Path(__file__).resolve().parents[2] / 'supabase/migrations/20261106110000_permissions_sales_invoices_expenses.sql'


@pytest.fixture
def switched(invoicing):
    with psycopg.connect(URL) as c:
        c.execute(SWITCH.read_text(encoding='utf-8'))
    return invoicing


def assign(business, person, template):
    with psycopg.connect(URL) as c:
        c.execute("""UPDATE memberships SET role_template_id=(SELECT id FROM authz.role_templates WHERE code=%s AND business_id IS NULL)
                     WHERE business_id=%s AND user_id=%s""", (template, business, person))


def override(business, person, permission, effect):
    with psycopg.connect(URL) as c:
        c.execute('INSERT INTO authz.membership_overrides VALUES(%s,%s,%s,%s)', (business, person, permission, effect))


def manage(business, actor, operation, details, item=None):
    return run(actor, 'SELECT public.management_write(%s,%s,%s,%s,%s,%s)',
               (business, uuid4(), operation, item, None, json.dumps(details)))[0][0]


def test_every_function_is_switched_once_and_running_the_migration_again_changes_nothing(switched):
    with psycopg.connect(URL) as c:
        c.execute(SWITCH.read_text(encoding='utf-8'))
        bodies = dict(c.execute("""SELECT p.proname, pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname IN ('process_sale_safe','create_invoice_safe','record_payment_atomic',
              'update_invoice_status_safe','record_ledger_entry_safe','management_write')""").fetchall())
    assert len(bodies) == 6 and all(body.count('authz.require') == 1 for body in bodies.values())


def test_editors_keep_exactly_what_they_could_do(switched):
    _, legacy, _, people, ids = switched
    invoice = create(legacy, people['editor'], lines((ids['rice'], 1)), customer=ids['customer'])
    run(people['editor'], 'SELECT public.update_invoice_status_safe(%s,%s,%s)', (legacy, invoice['id'], 'void'))
    assert entry(legacy, people['editor'], kind='Expense', description='Diesel')['type'] == 'Expense'
    assert manage(legacy, people['editor'], 'item.save', {'name': 'Garri', 'unit_price': '800'})['name'] == 'Garri'
    with pytest.raises(psycopg.Error, match='ACCESS_DENIED|PERMISSION_DENIED'):  # still not staff management
        manage(legacy, people['editor'], 'location.save', {'name': 'Second shop'})


def test_a_cashier_template_sells_and_invoices_but_cannot_spend_void_or_change_stock(switched):
    _, legacy, _, people, ids = switched
    cashier = people['editor']  # role stays editor; the template now decides too
    assign(legacy, cashier, 'cashier')
    invoice = create(legacy, cashier, lines((ids['beans'], 2)), customer=ids['customer'])
    assert invoice['status'] == 'sent'
    for refused in (
        lambda: entry(legacy, cashier, kind='Expense', description='Diesel'),
        lambda: run(cashier, 'SELECT public.update_invoice_status_safe(%s,%s,%s)', (legacy, invoice['id'], 'void')),
        lambda: manage(legacy, cashier, 'item.save', {'name': 'Garri', 'unit_price': '800'}),
    ):
        with pytest.raises(psycopg.errors.InsufficientPrivilege, match='PERMISSION_DENIED'):
            refused()


def test_overrides_reach_the_functions_and_owners_are_unaffected(switched):
    d, legacy, _, people, ids = switched
    override(legacy, people['editor'], 'invoices.post', 'revoke')
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match='PERMISSION_DENIED invoices.post'):
        create(legacy, people['editor'], lines((ids['rice'], 1)), customer=ids['customer'])
    assert create(legacy, people['editor'], lines((ids['rice'], 1)), kind='Estimate', customer=ids['customer'])['status'] == 'draft'
    assert create(legacy, people['owner'], lines((ids['rice'], 1)), customer=ids['customer'])['status'] == 'sent'
    override(legacy, people['owner'], 'invoices.post', 'revoke')  # owners hold everything; overrides cannot take it away
    assert create(legacy, people['owner'], lines((ids['rice'], 1)), customer=ids['customer'])['status'] == 'sent'


@pytest.fixture
def api(database, monkeypatch):
    from fastapi.testclient import TestClient
    import app as api_module
    import cacu.accounting.session as sessions
    staff = uuid4()
    with psycopg.connect(URL) as c:
        c.execute("INSERT INTO memberships(business_id,user_id,role) VALUES(%s,%s,'editor')", (database[1], staff))

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
    api_module.app.dependency_overrides[api_module.current_user] = lambda: staff
    try:
        yield database, staff, TestClient(api_module.app)
    finally:
        api_module.app.dependency_overrides.pop(api_module.current_user, None)


def test_the_native_api_asks_for_the_permission_of_each_action(api):
    d, staff, client = api
    base = f'/api/v1/businesses/{d[1]}'
    expense = {'request_key': str(uuid4()), 'kind': 'expense', 'source_id': str(uuid4()), 'main_account_id': str(uuid4()),
               'entry_date': f'{d[6]}-02-11', 'narration': 'Diesel', 'main_amount': '500.00', 'lines': [{'account_id': str(uuid4()), 'amount': '500.00'}]}
    sale = {'request_key': str(uuid4()), 'items': [{'item_id': str(uuid4()), 'quantity': 1}], 'entry_date': f'{d[6]}-02-11',
            'method': 'Cash', 'quoted_total': '100.00'}
    detail = lambda response: str(response.json().get('detail', ''))
    assert 'permission' not in detail(client.post(f'{base}/postings', json=expense))  # Editor (legacy): passes the check
    assign(d[1], staff, 'cashier')
    refused = client.post(f'{base}/postings', json={**expense, 'request_key': str(uuid4())})
    assert refused.status_code == 403 and 'You do not have permission' in detail(refused)
    assert 'permission' not in detail(client.post(f'{base}/sales', json=sale))  # a cashier sells
