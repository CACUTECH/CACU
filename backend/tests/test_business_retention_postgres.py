"""R0 GAP-10 on real disposable PostgreSQL, never hosted business data."""
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4
import psycopg
from psycopg import sql
import pytest
from test_management_postgres import managed, database, write, read, native
from cacu.accounting.catalog import CatalogMutation

URL = os.getenv('CACU_TEST_DATABASE_URL')
pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
MIGRATION = Path(__file__).resolve().parents[2] / 'supabase/migrations/20261029143527_retain_business_history.sql'
TABLES = ('accounts appointments attendance catalog_items customers employees financial_transactions '
          'invoice_items invoices jobs journal_entries journal_lines notification_logs notification_preferences '
          'notifications payment_events payment_status_history payments payroll_runs payslips storefront_settings '
          'suppliers transaction_items transactions').split()


def apply(c):
    c.execute(MIGRATION.read_text(encoding='utf-8'))


@pytest.fixture
def history():
    parsed = urlparse(URL)
    assert parsed.hostname in {'localhost','127.0.0.1','postgres'} and parsed.path.endswith('_test'), 'Refuse non-local test database'
    business, other, owner, foreign_owner = [uuid4() for _ in range(4)]
    with psycopg.connect(URL) as c:
        for schema in ['management_private','upload_private','hr_private','legacy_private','onboarding_private','accounting','auth','public']:
            c.execute(sql.SQL('DROP SCHEMA IF EXISTS {} CASCADE').format(sql.Identifier(schema)))
        c.execute('CREATE SCHEMA public; CREATE SCHEMA auth; CREATE SCHEMA onboarding_private')
        for role in ['anon','authenticated','cacu_runtime']:
            if not c.execute('SELECT 1 FROM pg_roles WHERE rolname=%s',(role,)).fetchone():
                c.execute(sql.SQL('CREATE ROLE {} NOLOGIN').format(sql.Identifier(role)))
        c.execute('''CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
          SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
          CREATE TABLE public.businesses(id uuid PRIMARY KEY,name text NOT NULL);
          CREATE TABLE public.memberships(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,user_id uuid,role text,is_active boolean DEFAULT true);
          CREATE TABLE onboarding_private.business_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,payload jsonb);
          ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
          GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,cacu_runtime;
          GRANT SELECT ON public.memberships TO authenticated;
          GRANT ALL ON public.businesses TO authenticated,anon,cacu_runtime;
          GRANT DELETE,TRUNCATE ON public.businesses TO PUBLIC;
          CREATE POLICY businesses_select_members ON public.businesses FOR SELECT TO authenticated USING
            (EXISTS(SELECT FROM public.memberships m WHERE m.business_id=businesses.id AND m.user_id=auth.uid() AND m.is_active));
          CREATE POLICY businesses_update_owner_admin ON public.businesses FOR UPDATE TO authenticated USING
            (EXISTS(SELECT FROM public.memberships m WHERE m.business_id=businesses.id AND m.user_id=auth.uid() AND m.role IN ('owner','admin') AND m.is_active));
          CREATE POLICY businesses_delete_owner_only ON public.businesses FOR DELETE TO authenticated USING
            (EXISTS(SELECT FROM public.memberships m WHERE m.business_id=businesses.id AND m.user_id=auth.uid() AND m.role='owner' AND m.is_active));
        ''')
        c.execute('INSERT INTO businesses VALUES(%s,%s),(%s,%s)',(business,'History business',other,'Other business'))
        c.execute("INSERT INTO memberships(business_id,user_id,role) VALUES(%s,%s,'owner'),(%s,%s,'owner')",(business,owner,other,foreign_owner))
        for table in TABLES:
            c.execute(sql.SQL('CREATE TABLE public.{}(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,payload jsonb)').format(sql.Identifier(table)))
            c.execute(sql.SQL('INSERT INTO public.{}(business_id,payload) VALUES(%s,%s::jsonb),(%s,%s::jsonb)').format(sql.Identifier(table)),(business,'{"saved":123}',other,'{"saved":456}'))
        c.execute('INSERT INTO onboarding_private.business_requests(business_id,payload) VALUES(%s,%s::jsonb)',(business,'{"request":"saved"}'))
    return business,other,owner,foreign_owner


def snapshot():
    with psycopg.connect(URL) as c:
        tables=[('public','businesses'),('public','memberships'),('onboarding_private','business_requests')]+[('public',t) for t in TABLES]
        return {schema+'.'+table:c.execute(sql.SQL('SELECT to_jsonb(t) FROM {}.{} t ORDER BY id').format(sql.Identifier(schema),sql.Identifier(table))).fetchall() for schema,table in tables}


def claims(c,identity):
    c.execute('SET LOCAL ROLE authenticated')
    c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':str(identity)}),))


def test_reproduces_owner_cascade_before_migration(history):
    with psycopg.connect(URL) as c:
        claims(c,history[2]);assert c.execute('DELETE FROM businesses WHERE id=%s RETURNING id',(history[0],)).fetchall()==[(history[0],)]
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT count(*) FROM invoices WHERE business_id=%s',(history[0],)).fetchone()[0]==0
        assert c.execute('SELECT count(*) FROM invoices WHERE business_id=%s',(history[1],)).fetchone()[0]==1


def test_preserves_all_rows_and_converts_all_26_references(history):
    before=snapshot()
    with psycopg.connect(URL) as c:
        assert c.execute("SELECT count(*) FROM pg_constraint WHERE confrelid='public.businesses'::regclass AND confdeltype='c'").fetchone()[0]==26
        apply(c)
        assert c.execute("SELECT count(*) FROM pg_constraint WHERE confrelid='public.businesses'::regclass AND confdeltype='c'").fetchone()[0]==0
        assert c.execute("SELECT count(*) FROM pg_constraint WHERE confrelid='public.businesses'::regclass AND confdeltype='r' AND convalidated").fetchone()[0]==26
    assert snapshot()==before


@pytest.mark.parametrize('role,active',[('owner',True),('admin',True),('editor',True),('viewer',True),('owner',False),('outsider',False)])
def test_application_actor_cannot_delete_history(history,role,active):
    identity=uuid4()
    with psycopg.connect(URL) as c:
        if role!='outsider':c.execute('INSERT INTO memberships(business_id,user_id,role,is_active) VALUES(%s,%s,%s,%s)',(history[0],identity,role,active))
        apply(c)
    before=snapshot()
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with psycopg.connect(URL) as c:
            claims(c,identity);c.execute('DELETE FROM businesses WHERE id=%s',(history[0],))
    assert snapshot()==before


@pytest.mark.parametrize('role',['anon','authenticated','cacu_runtime'])
def test_no_delete_or_truncate_even_through_public(history,role):
    with psycopg.connect(URL) as c:
        apply(c)
        assert c.execute("SELECT has_table_privilege(%s,'public.businesses','DELETE'),has_table_privilege(%s,'public.businesses','TRUNCATE')",(role,role)).fetchone()==(False,False)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with psycopg.connect(URL) as c:
            c.execute(sql.SQL('SET LOCAL ROLE {}').format(sql.Identifier(role)));c.execute('TRUNCATE public.businesses CASCADE')


def test_policy_blocks_accidentally_regranted_delete(history):
    with psycopg.connect(URL) as c:
        apply(c);c.execute('GRANT DELETE ON businesses TO authenticated')
        c.execute('CREATE POLICY accidental_delete ON businesses FOR DELETE TO authenticated USING(true)')
    before=snapshot()
    with psycopg.connect(URL) as c:
        claims(c,history[2]);assert c.execute('DELETE FROM businesses RETURNING id').fetchall()==[]
    assert snapshot()==before


def test_privileged_delete_cannot_cascade(history):
    with psycopg.connect(URL) as c:apply(c)
    before=snapshot()
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        with psycopg.connect(URL) as c:c.execute('DELETE FROM businesses WHERE id=%s',(history[0],))
    assert snapshot()==before


def test_owner_read_update_and_foreign_isolation_survive(history):
    with psycopg.connect(URL) as c:apply(c)
    with psycopg.connect(URL) as c:
        claims(c,history[2]);assert c.execute('SELECT id FROM businesses').fetchall()==[(history[0],)]
        assert c.execute("UPDATE businesses SET name='Reviewed name' WHERE id=%s RETURNING id",(history[0],)).fetchall()==[(history[0],)]
        assert c.execute("UPDATE businesses SET name='Forbidden' WHERE id=%s RETURNING id",(history[1],)).fetchall()==[]


def test_fk_attributes_and_quoted_identifiers_preserved(history):
    with psycopg.connect(URL) as c:
        c.execute('''CREATE TABLE public."odd history"("ON DELETE CASCADE" uuid);
          ALTER TABLE public."odd history" ADD CONSTRAINT "odd foreign key" FOREIGN KEY("ON DELETE CASCADE") REFERENCES public.businesses(id) MATCH FULL ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED NOT VALID;
          COMMENT ON CONSTRAINT "odd foreign key" ON public."odd history" IS 'Preserve this comment';
          CREATE TABLE public.unchanged_business_reference(business_id uuid REFERENCES public.businesses(id));''')
        apply(c)
        row=c.execute("SELECT convalidated,condeferrable,condeferred,confupdtype,confmatchtype,confdeltype,obj_description(oid,'pg_constraint'),pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='odd foreign key'").fetchone()
        assert row[:7]==(False,True,True,'c','f','r','Preserve this comment')
        assert '"ON DELETE CASCADE"' in row[7]
        assert c.execute("SELECT confdeltype FROM pg_constraint WHERE conrelid='public.unchanged_business_reference'::regclass").fetchone()[0]=='a'


def test_failure_rolls_back_every_change(history):
    with psycopg.connect(URL) as c:c.execute('CREATE TABLE public.partitioned_history(id int,business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE) PARTITION BY RANGE(id)')
    before=snapshot()
    with pytest.raises(psycopg.errors.RaiseException,match='non-ordinary'):
        with psycopg.connect(URL) as c:apply(c)
    with psycopg.connect(URL) as c:
        assert c.execute("SELECT has_table_privilege('authenticated','public.businesses','DELETE')").fetchone()[0]
        assert c.execute("SELECT count(*) FROM pg_policy WHERE polrelid='public.businesses'::regclass AND polname='businesses_delete_owner_only'").fetchone()[0]==1
        assert c.execute("SELECT count(*) FROM pg_constraint WHERE confrelid='public.businesses'::regclass AND confdeltype='r'").fetchone()[0]==0
    assert snapshot()==before


@pytest.mark.parametrize('mode',['legacy','native'])
def test_management_stock_and_replay_survive(managed,mode):
    with psycopg.connect(URL) as c:
        if mode=='legacy': c.execute("UPDATE accounting.business_map SET state='staged'")
        apply(c)
    key=uuid4();details={'name':'Retained item','item_type':'PRODUCT','unit_price':'100','cost_price':'2','opening_quantity':3,'opening_date':f'{managed[6]}-02-10'}
    if mode=='native':
        command=CatalogMutation(request_key=key,operation='item.save',details=details)
        first=native(managed,command);assert native(managed,command)==first
    else:
        details.pop('opening_date')
        first=write(managed,'item.save',details,key=key)
        assert write(managed,'item.save',details,key=key)==dict(first,replayed=True)
    assert read(managed,'catalog')['total']==1
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT stock_quantity FROM catalog_items WHERE id=%s',(first['id'],)).fetchone()[0]==3
        assert c.execute('SELECT count(*) FROM inventory_movements').fetchone()[0]==1


def test_empty_business_has_no_application_delete_privilege(history):
    empty=uuid4()
    with psycopg.connect(URL) as c:
        apply(c);c.execute('INSERT INTO businesses VALUES(%s,%s)',(empty,'Empty business'))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with psycopg.connect(URL) as c:
            claims(c,history[2]);c.execute('DELETE FROM businesses WHERE id=%s',(empty,))
    with psycopg.connect(URL) as c:assert c.execute('SELECT id FROM businesses WHERE id=%s',(empty,)).fetchone()==(empty,)


def test_lock_contention_aborts_without_partial_changes(history):
    before=snapshot()
    with psycopg.connect(URL) as blocker:
        blocker.execute('LOCK TABLE public.accounts IN ACCESS EXCLUSIVE MODE')
        with pytest.raises(psycopg.errors.LockNotAvailable):
            with psycopg.connect(URL) as c:apply(c)
    assert snapshot()==before
    with psycopg.connect(URL) as c:
        assert c.execute("SELECT has_table_privilege('authenticated','public.businesses','DELETE')").fetchone()[0]
        assert c.execute("SELECT count(*) FROM pg_constraint WHERE confrelid='public.businesses'::regclass AND confdeltype='c'").fetchone()[0]==26
