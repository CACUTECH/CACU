"""R0 legacy financial write boundary (GAP-01, GAP-02, GAP-03, GAP-06) on disposable PostgreSQL fixtures."""
import json
from decimal import Decimal
from pathlib import Path
from uuid import uuid4
import psycopg
import pytest
from test_management_postgres import managed, database, URL

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
FINANCIAL = ['financial_transactions', 'transactions', 'transaction_items', 'journal_entries', 'journal_lines',
             'invoices', 'invoice_items', 'payments', 'payment_events', 'payment_status_history', 'accounts']


@pytest.fixture
def boundary(managed):
    d = managed
    legacy, other = uuid4(), uuid4()
    people = {role: uuid4() for role in ['owner', 'editor', 'viewer', 'outsider']}
    with psycopg.connect(URL) as c:
        c.execute("""ALTER TABLE public.financial_transactions ADD COLUMN description text, ADD COLUMN amount numeric(15,2),
            ADD COLUMN type text, ADD COLUMN category text, ADD COLUMN date date, ADD COLUMN created_by uuid,
            ADD COLUMN created_at timestamptz DEFAULT now(), ALTER COLUMN id SET DEFAULT gen_random_uuid();
          ALTER TABLE public.audit_logs ADD COLUMN table_name text, ADD COLUMN record_id uuid, ADD COLUMN details jsonb,
            ALTER COLUMN id SET DEFAULT gen_random_uuid();
          ALTER TABLE public.invoices ADD CONSTRAINT invoices_status_check CHECK(status IN ('draft','sent','paid','overdue','void'));
          CREATE TABLE public.payment_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid);
          CREATE TABLE public.payment_status_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid);
          ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY; ALTER TABLE public.payment_status_history ENABLE ROW LEVEL SECURITY;""")
        # Mirror hosted Supabase: authenticated holds full table grants and member read policies.
        for table in FINANCIAL:
            c.execute(f'GRANT ALL ON public.{table} TO authenticated')
            c.execute(f'ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY')
            c.execute(f'CREATE POLICY member_all ON public.{table} TO authenticated USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id))')
        c.execute('GRANT SELECT,INSERT ON public.audit_logs TO authenticated')
        for business in (legacy, other):
            c.execute('INSERT INTO businesses(id,name) VALUES(%s,%s)', (business, 'Legacy shop'))
        for role, person in people.items():
            if role != 'outsider':
                c.execute('INSERT INTO memberships(business_id,user_id,role,is_active) VALUES(%s,%s,%s,true)', (legacy, person, role))
        c.execute('INSERT INTO memberships(business_id,user_id,role,is_active) VALUES(%s,%s,%s,true)', (other, people['outsider'], 'owner'))
        c.execute(Path('../supabase/migrations/20261030100000_legacy_financial_write_boundary.sql').read_text(encoding='utf-8'))
    return d, legacy, other, people


def run(actor, sql, args=()):
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE authenticated')
        c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': str(actor)}),))
        return c.execute(sql, args).fetchall()


def entry(business, actor, key=None, amount='1500.00', kind='Income', description='Cash float top-up'):
    return run(actor, 'SELECT public.record_ledger_entry_safe(%s,%s,%s,%s,%s,%s,NULL)',
               (business, key or uuid4(), description, Decimal(amount), kind, 'Sales'))[0][0]


@pytest.mark.parametrize('table', FINANCIAL)
def test_signed_in_users_cannot_write_financial_tables_directly(boundary, table):
    _, legacy, _, people = boundary
    with psycopg.connect(URL) as c:
        for privilege in ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']:
            assert c.execute('SELECT has_table_privilege(%s,%s,%s)', ('authenticated', f'public.{table}', privilege)).fetchone() == (False,)
        assert c.execute('SELECT has_table_privilege(%s,%s,%s)', ('authenticated', f'public.{table}', 'SELECT')).fetchone() == (True,)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        run(people['owner'], f'INSERT INTO public.{table}(business_id) VALUES(%s)', (legacy,))


def test_editor_records_entry_atomically_with_audit_and_replay(boundary):
    _, legacy, _, people = boundary
    key = uuid4()
    first = entry(legacy, people['editor'], key)
    again = entry(legacy, people['editor'], key)
    assert first['replayed'] is False and again['replayed'] is True and again['id'] == first['id']
    assert Decimal(str(first['amount'])) == Decimal('1500.00') and first['created_by'] == str(people['editor'])
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT count(*) FROM financial_transactions WHERE business_id=%s', (legacy,)).fetchone() == (1,)
        assert c.execute("SELECT action, details->>'request_key' FROM audit_logs WHERE record_id=%s", (first['id'],)).fetchall() == [('MANUAL_JOURNAL_ENTRY', str(key))]
    with pytest.raises(psycopg.Error, match='REQUEST_KEY_REUSED'):
        entry(legacy, people['editor'], key, amount='2000.00')


@pytest.mark.parametrize('role', ['viewer', 'outsider'])
def test_viewers_and_other_tenants_cannot_record_entries(boundary, role):
    _, legacy, _, people = boundary
    with pytest.raises(psycopg.Error, match='ACCESS_DENIED'):
        entry(legacy, people[role])


@pytest.mark.parametrize('amount,kind,description', [('0', 'Income', 'x'), ('-5', 'Expense', 'x'), ('1.005', 'Income', 'x'),
                                                     ('10', 'Transfer', 'x'), ('10', 'Income', '  ')])
def test_invalid_entries_are_refused(boundary, amount, kind, description):
    _, legacy, _, people = boundary
    with pytest.raises(psycopg.Error, match='INVALID_LEDGER_ENTRY'):
        entry(legacy, people['owner'], amount=amount, kind=kind, description=description)


def test_activated_business_must_use_accounting_postings(boundary):
    d, _, _, _ = boundary
    with pytest.raises(psycopg.Error, match='USE_ACCOUNTING_POSTINGS'):
        entry(d[1], d[2])


def test_invoice_status_allows_only_defined_transitions(boundary):
    _, legacy, other, people = boundary
    invoice, paid, foreign = uuid4(), uuid4(), uuid4()
    with psycopg.connect(URL) as c:
        c.execute("INSERT INTO invoices(id,business_id,status,total) VALUES(%s,%s,'draft',100),(%s,%s,'sent',100),(%s,%s,'draft',100)",
                  (invoice, legacy, paid, legacy, foreign, other))
        c.execute('INSERT INTO payments(id,business_id,invoice_id,amount,status) VALUES(%s,%s,%s,50,%s)', (uuid4(), legacy, paid, 'success'))
    status = lambda inv, value, actor=people['editor'], business=legacy: run(actor, 'SELECT public.update_invoice_status_safe(%s,%s,%s)', (business, inv, value))[0][0]
    assert status(invoice, 'sent')['status'] == 'sent'
    for bad in ['draft', 'paid', 'Accepted']:
        with pytest.raises(psycopg.Error, match='INVALID_STATUS_TRANSITION'):
            status(invoice, bad)
    with pytest.raises(psycopg.Error, match='INVOICE_HAS_PAYMENTS'):
        status(paid, 'void')
    with pytest.raises(psycopg.Error, match='INVOICE_NOT_FOUND'):
        status(foreign, 'sent')
    with pytest.raises(psycopg.Error, match='ACCESS_DENIED'):
        status(invoice, 'void', actor=people['viewer'])
    assert status(invoice, 'void')['status'] == 'void'


def test_editors_cannot_change_stock_outside_movements(boundary):
    _, legacy, _, people = boundary
    with psycopg.connect(URL) as c:
        item = c.execute("INSERT INTO catalog_items(id,business_id,name,item_type,stock_quantity,cost_price,unit_price) VALUES(%s,%s,'Rice','PRODUCT',5,1,2) RETURNING id",
                         (uuid4(), legacy)).fetchone()[0]
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        run(people['editor'], 'UPDATE catalog_items SET stock_quantity=999 WHERE id=%s', (item,))


def test_ledger_trigger_has_fixed_search_path_and_stays_immutable(boundary):
    with psycopg.connect(URL) as c:
        assert c.execute("SELECT proconfig FROM pg_proc WHERE oid='accounting.immutable_ledger'::regproc").fetchone()[0] == ['search_path=pg_catalog, pg_temp']
