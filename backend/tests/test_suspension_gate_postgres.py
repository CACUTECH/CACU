"""A suspended subscription is read-only (Doc 14 SUB-10): no new trading through any path, but payments received still
record. Uses the shared library database, which carries the real native ledger, plans and the suspension gate."""
import os
from uuid import uuid4
import psycopg
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.pool import NullPool
from test_library_postgres import database  # noqa: F401  (fixture)

DSN = os.environ.get('CACU_TEST_DATABASE_URL')
pytestmark = pytest.mark.skipif(not DSN, reason='disposable Postgres test URL required')


def set_status(business, status):
    with psycopg.connect(DSN) as c:
        c.execute("SELECT set_config('platform.actor_kind','system',true), set_config('platform.reason','Suspension gate test',true)")
        c.execute("""INSERT INTO platform.subscriptions(business_id, plan_code, status) VALUES (%s,'GROW',%s)
                     ON CONFLICT (business_id) DO UPDATE SET status=EXCLUDED.status""", (business, status))


@pytest.fixture
def api(database, monkeypatch):
    """The FastAPI app against the fixture database, as the restricted runtime role."""
    from fastapi.testclient import TestClient
    import app as api_module
    import cacu.accounting.session as sessions

    def test_engine(*args, **kwargs):
        engine = create_engine(DSN.replace('postgresql://', 'postgresql+psycopg://'), poolclass=NullPool)

        @event.listens_for(engine, 'connect')
        def role(connection, record):
            connection.autocommit = True
            with connection.cursor() as cursor:
                cursor.execute('SET ROLE cacu_runtime')
            connection.autocommit = False
        return engine
    monkeypatch.setenv('CACU_DATABASE_URL', DSN)
    monkeypatch.setattr(sessions, 'create_engine', test_engine)
    api_module.app.dependency_overrides[api_module.current_user] = lambda: database[2]
    try:
        yield database, TestClient(api_module.app)
    finally:
        api_module.app.dependency_overrides.pop(api_module.current_user, None)


def test_native_sales_and_expenses_are_refused_while_suspended_but_receipts_are_not(api):
    d, client = api
    base = f'/api/v1/businesses/{d[1]}'
    sale = {'request_key': str(uuid4()), 'items': [{'item_id': str(uuid4()), 'quantity': 1}], 'entry_date': f'{d[6]}-02-11',
            'method': 'Cash', 'quoted_total': '100.00'}
    receipt = {'request_key': str(uuid4()), 'invoice_id': str(uuid4()), 'amount': '100.00', 'entry_date': f'{d[6]}-02-11', 'method': 'Cash'}
    set_status(d[1], 'suspended')
    refused = client.post(f'{base}/sales', json=sale)
    assert refused.status_code == 403 and 'read-only until the subscription is paid' in refused.json()['detail']
    posting = lambda kind: {'request_key': str(uuid4()), 'kind': kind, 'source_id': str(uuid4()), 'main_account_id': str(uuid4()),
                            'entry_date': f'{d[6]}-02-11', 'narration': 'Diesel', 'main_amount': '500.00',
                            'lines': [{'account_id': str(uuid4()), 'amount': '500.00'}]}
    assert 'read-only' in client.post(f'{base}/postings', json=posting('expense')).json().get('detail', '')
    assert 'read-only' not in str(client.post(f'{base}/postings', json=posting('receipt')).json().get('detail', ''))
    # A receipt passes the gate; it fails later only because this invoice does not exist.
    allowed = client.post(f'{base}/receipts', json=receipt)
    assert 'read-only' not in str(allowed.json().get('detail', ''))
    set_status(d[1], 'active')
    assert 'read-only' not in str(client.post(f'{base}/sales', json=sale).json().get('detail', ''))


def legacy_business():
    """A business still on the legacy path (not activated on the native ledger), like those in production today."""
    ident = uuid4()
    with psycopg.connect(DSN) as c:
        c.execute('INSERT INTO public.businesses(id,name) VALUES(%s,%s)', (ident, 'Legacy shop'))
    return ident


def test_every_trading_table_refuses_new_rows_while_suspended(database):
    business = legacy_business()
    with psycopg.connect(DSN) as c:
        c.execute('ALTER TABLE public.financial_transactions ADD COLUMN reference_type text')
        guarded = {r for (r,) in c.execute("SELECT event_object_table FROM information_schema.triggers WHERE trigger_name LIKE '%_read_only_when_suspended'")}
    assert {'invoices', 'transactions', 'financial_transactions', 'customers', 'suppliers', 'catalog_items', 'memberships'} <= guarded
    inserts = [
        ('INSERT INTO public.customers(id,business_id,name) VALUES(%s,%s,%s)', (uuid4(), business, 'Mama Ngozi')),
        ('INSERT INTO public.suppliers(id,business_id,name) VALUES(%s,%s,%s)', (uuid4(), business, 'Dangote depot')),
        ('INSERT INTO public.catalog_items(id,business_id,name,item_type) VALUES(%s,%s,%s,%s)', (uuid4(), business, 'Peak milk', 'PRODUCT')),
        ("INSERT INTO public.invoices(id,business_id,status) VALUES(%s,%s,'draft')", (uuid4(), business)),
        ("INSERT INTO public.transactions(id,business_id,status,payment_method) VALUES(%s,%s,'completed','cash')", (uuid4(), business)),
        ('INSERT INTO public.financial_transactions(id,business_id) VALUES(%s,%s)', (uuid4(), business)),
        ("INSERT INTO public.memberships(business_id,user_id,role) VALUES(%s,%s,'viewer')", (business, uuid4())),
    ]
    set_status(business, 'suspended')
    for sql, args in inserts:
        with psycopg.connect(DSN) as c:
            with pytest.raises(psycopg.errors.RaiseException, match='SUBSCRIPTION_READ_ONLY'):
                c.execute(sql, args)
    with psycopg.connect(DSN) as c:  # a legacy receipt's income event still records
        c.execute("INSERT INTO public.financial_transactions(id,business_id,reference_type) VALUES(%s,%s,'Payment')", (uuid4(), business))
    set_status(business, 'active')
    for sql, args in inserts:
        with psycopg.connect(DSN) as c:
            c.execute(sql, args)


def test_staff_can_be_removed_but_not_brought_back_while_suspended(database):
    d = database
    staff = uuid4()
    with psycopg.connect(DSN) as c:
        c.execute("INSERT INTO public.memberships(business_id,user_id,role) VALUES(%s,%s,'editor')", (d[1], staff))
    set_status(d[1], 'suspended')
    with psycopg.connect(DSN) as c:
        c.execute('UPDATE public.memberships SET is_active=false WHERE user_id=%s', (staff,))
    with psycopg.connect(DSN) as c:
        with pytest.raises(psycopg.errors.RaiseException, match='SUBSCRIPTION_READ_ONLY'):
            c.execute('UPDATE public.memberships SET is_active=true WHERE user_id=%s', (staff,))


@pytest.mark.parametrize('status', ['trialing', 'incomplete', 'past_due', 'grace', 'active'])
def test_grace_and_paid_states_keep_full_access_and_unbilled_businesses_are_untouched(database, status):
    d = database
    with psycopg.connect(DSN) as c:  # unbilled: no subscription row
        c.execute('INSERT INTO public.customers(id,business_id,name) VALUES(%s,%s,%s)', (uuid4(), d[1], 'Walk-in'))
    set_status(d[1], status)
    with psycopg.connect(DSN) as c:
        c.execute('INSERT INTO public.customers(id,business_id,name) VALUES(%s,%s,%s)', (uuid4(), d[1], 'Regular'))
