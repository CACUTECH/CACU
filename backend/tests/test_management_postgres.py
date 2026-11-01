"""Management migration and native inventory on a disposable loopback *_test database."""
import json,os
from decimal import Decimal
from sqlalchemy.exc import SQLAlchemyError
from pathlib import Path
from uuid import uuid4
import psycopg
from psycopg.types.json import Jsonb
import pytest
from fastapi import HTTPException
from test_library_postgres import database,session_for
from cacu.accounting.catalog import CatalogMutation,catalog_mutate
URL=os.getenv('CACU_TEST_DATABASE_URL')
pytestmark=pytest.mark.skipif(not URL,reason='Disposable management PostgreSQL required')

@pytest.fixture
def managed(database,request):
    with psycopg.connect(URL) as c:
        c.execute("""DROP SCHEMA IF EXISTS management_private CASCADE;DROP SCHEMA IF EXISTS upload_private CASCADE;DROP SCHEMA IF EXISTS legacy_private CASCADE;DROP SCHEMA IF EXISTS auth CASCADE;CREATE SCHEMA auth;DROP SCHEMA IF EXISTS storage CASCADE;CREATE SCHEMA storage;
        CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
        CREATE TABLE storage.objects(id uuid PRIMARY KEY,bucket_id text,name text);
        DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; END $$;
        DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; END $$;
        CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
        CREATE TABLE auth.audit_log_entries(id uuid PRIMARY KEY,payload jsonb,created_at timestamptz DEFAULT now());
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
        GRANT USAGE ON SCHEMA auth,public TO authenticated,anon,cacu_runtime;
        ALTER TABLE public.memberships ADD COLUMN id uuid DEFAULT gen_random_uuid() PRIMARY KEY,ADD COLUMN created_at timestamptz DEFAULT now(),ADD COLUMN updated_at timestamptz DEFAULT now();
        CREATE TYPE public.membership_role AS ENUM('owner','admin','editor','viewer');
        ALTER TABLE public.memberships ALTER COLUMN role TYPE public.membership_role USING role::public.membership_role;
        ALTER TABLE public.catalog_items ADD COLUMN sku text,ADD COLUMN category text,ADD COLUMN description text,ADD COLUMN duration integer DEFAULT 0,ADD COLUMN reorder_level integer DEFAULT 0,ADD COLUMN created_at timestamptz DEFAULT now(),ADD COLUMN updated_at timestamptz DEFAULT now();
        ALTER TABLE public.businesses ADD COLUMN logo_url text;
        CREATE TABLE public.profiles(id uuid PRIMARY KEY,full_name text);
        CREATE TABLE public.audit_logs(id uuid PRIMARY KEY,business_id uuid,user_id uuid,action text,created_at timestamptz DEFAULT now());
        CREATE SCHEMA legacy_private;
        CREATE TABLE legacy_private.sale_requests(business_id uuid,request_key uuid,actor_id uuid,payload jsonb,sale_id uuid,created_at timestamptz DEFAULT now(),PRIMARY KEY(business_id,request_key));
        DROP FUNCTION public.is_business_member(uuid) CASCADE;
        CREATE FUNCTION public.is_business_member(p_business_id uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
        CREATE FUNCTION public.has_business_role(p_business_id uuid,p_roles public.membership_role[]) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
        GRANT ALL ON public.catalog_items,public.memberships TO authenticated;
        GRANT UPDATE(name) ON public.catalog_items TO authenticated;
        """)
        c.execute(Path('../supabase/migrations/20261011030324_secure_file_uploads.sql').read_text(encoding='utf-8-sig'))
        if getattr(request,'param',None)=='legacy':
            c.execute('ALTER TABLE public.catalog_items DISABLE TRIGGER accounting_cutover_guard')
            for name in ['Old item','Duplicate legacy code']:
                c.execute("INSERT INTO catalog_items(id,business_id,name,item_type,stock_quantity,cost_price,unit_price,category,sku) VALUES(%s,%s,%s,'PRODUCT',7,2.3456,100,' Old category ','legacy-code')",(uuid4(),database[1],name))
            c.execute('ALTER TABLE public.catalog_items ENABLE TRIGGER accounting_cutover_guard')
        c.execute(Path('../supabase/migrations/20261012140639_inventory_user_management.sql').read_text(encoding='utf-8-sig'))
        c.execute('CREATE TRIGGER memberships_prevent_last_owner_loss BEFORE UPDATE OR DELETE ON public.memberships FOR EACH ROW EXECUTE FUNCTION public.prevent_last_owner_loss()')
        c.execute(Path('../supabase/migrations/20261101090000_stock_adjustment_approval.sql').read_text(encoding='utf-8'))
        c.execute('INSERT INTO auth.users VALUES(%s,%s,now())',(database[2],'owner@example.com'))
    return database

def write(d,op,details,id=None,version=None,key=None,actor=None):
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE authenticated')
        c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':str(actor or d[2])}),))
        return c.execute('SELECT public.management_write(%s,%s,%s,%s,%s,%s)',(d[1],key or uuid4(),op,id,version,Jsonb(details))).fetchone()[0]

def read(d,section,query=None,actor=None):
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE authenticated');c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':str(actor or d[2])}),))
        return c.execute('SELECT public.management_read(%s,%s,%s)',(d[1],section,Jsonb(query or {}))).fetchone()[0]

def native(d,command):
    with d[0].begin() as c:
        s=session_for(c,d)
        try:return catalog_mutate(s,d[2],command)
        finally:s.close()

def test_categories_items_versions_and_archive(managed):
    d=managed;cat=write(d,'category.save',{'name':'Widgets','item_type':'PRODUCT'})
    item=write(d,'item.save',{'name':'Widget','category_id':cat['id'],'unit_price':'150.50','cost_price':'20'})
    assert item['category']=='Widgets' and item['stock_quantity']==0
    assert read(d,'catalog')['total']==1
    changed=write(d,'item.save',{'name':'Better widget'},item['id'],item['version'])
    assert changed['version']==2 and Decimal(changed['unit_price'])==Decimal('150.50')
    with pytest.raises(psycopg.Error,match='VERSION_CONFLICT'):write(d,'item.save',{'name':'Stale'},item['id'],item['version'])
    write(d,'item.save',{'is_active':False},item['id'],changed['version'])
    assert read(d,'catalog',{'status':'active'})['total']==0
    assert read(d,'catalog',{'status':'archived'})['total']==1
    with pytest.raises(psycopg.Error):write(d,'category.save',{'name':' widgets ','item_type':'PRODUCT'})

def test_native_opening_and_adjustment_are_balanced_and_retry_safe(managed):
    d=managed;key=uuid4();cmd=CatalogMutation(request_key=key,operation='item.save',details={'name':'Stocked','unit_price':'100','cost_price':'20','opening_quantity':5,'opening_date':f'{d[6]}-02-10'})
    first=native(d,cmd);assert native(d,cmd)==first
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT stock_quantity FROM catalog_items WHERE id=%s',(first['id'],)).fetchone()[0]==5
        assert c.execute('SELECT count(*) FROM inventory_movements').fetchone()[0]==1
        assert c.execute('SELECT count(*) FROM accounting.document_map').fetchone()[0]==1
        assert c.execute("SELECT sum(amount) FILTER(WHERE entry_type='DEBIT')-sum(amount) FILTER(WHERE entry_type='CREDIT') FROM accounting.ledger").fetchone()[0]==0
    adjusted=native(d,CatalogMutation(request_key=uuid4(),operation='stock.adjust',item_id=first['id'],expected_version=first['version'],details={'delta':-2,'reason':'Damaged goods','entry_date':f'{d[6]}-02-11'}))
    assert adjusted['stock_quantity']==3
    with pytest.raises(HTTPException,match='would make it negative'):native(d,CatalogMutation(request_key=uuid4(),operation='stock.adjust',item_id=first['id'],expected_version=adjusted['version'],details={'delta':-4,'reason':'Too many','entry_date':f'{d[6]}-02-11'}))
    with psycopg.connect(URL) as c:assert c.execute('SELECT stock_quantity FROM catalog_items WHERE id=%s',(first['id'],)).fetchone()[0]==3

@pytest.mark.parametrize('details',[{'name':'Bad','unit_price':'-1'},{'name':'Bad','unit_price':'1.001'},{'name':'Bad','unit_price':'1.00001'},{'name':'Bad','item_type':'SERVICE','opening_quantity':2},{'name':'Bad','supplier_id':str(uuid4())}])
def test_invalid_item_has_no_writes(managed,details):
    with pytest.raises(psycopg.Error):write(managed,'item.save',details)
    assert read(managed,'catalog')['total']==0

def test_last_owner_role_escalation_and_deactivation(managed):
    d=managed
    with pytest.raises(psycopg.Error,match='LAST_OWNER'):write(d,'member.status',{'is_active':False},d[2],1)
    editor=uuid4();admin=uuid4()
    with psycopg.connect(URL) as c:
        for actor,role in [(editor,'editor'),(admin,'admin')]:
            c.execute('INSERT INTO auth.users VALUES(%s,%s,now())',(actor,f'{role}@example.com'));c.execute('INSERT INTO memberships(business_id,user_id,role) VALUES(%s,%s,%s)',(d[1],actor,role))
    with pytest.raises(psycopg.Error,match='OWNER_PERMISSION'):write(d,'member.save',{'name':'Hijack','role':'admin'},d[2],1,actor=admin)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):write(d,'member.status',{'is_active':False},admin,1,actor=editor)
    write(d,'member.status',{'is_active':False},editor,1)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):read(d,'catalog',actor=editor)
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE cacu_runtime');c.execute("SELECT set_config('request.jwt.claims',%s,true),set_config('cacu.business_id',%s,true)",(json.dumps({'sub':str(editor)}),str(d[1])))
        assert c.execute('SELECT accounting.lock_membership(%s,%s)',(d[1],editor)).fetchone()[0] is None
    write(d,'member.status',{'is_active':True},editor,2)
    assert read(d,'catalog',actor=editor)['total']==0

def test_invitation_accept_requires_matching_verified_email(managed):
    d=managed;i=write(d,'invitation.create',{'email':'new@example.com','name':'New user','role':'viewer'});actor=uuid4()
    with psycopg.connect(URL) as c:c.execute('INSERT INTO auth.users VALUES(%s,%s,now())',(actor,'new@example.com'))
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE authenticated');c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':str(d[2])}),))
        with pytest.raises(psycopg.Error,match='VERIFIED_INVITED_EMAIL'):c.execute('SELECT accept_business_invitation(%s)',(i['id'],))
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE authenticated');c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':str(actor)}),))
        assert c.execute('SELECT accept_business_invitation(%s)',(i['id'],)).fetchone()[0]==d[1]
    assert read(d,'users')['total']==2

def test_browser_column_and_table_writes_are_revoked(managed):
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE authenticated')
        with pytest.raises(psycopg.errors.InsufficientPrivilege):c.execute("UPDATE public.catalog_items SET name='Bypass'")

@pytest.mark.parametrize('managed',['legacy'],indirect=True)
def test_legacy_category_rename_and_duplicate_codes_preserve_existing_values(managed):
    d=managed;items=read(d,'catalog')['data'];cat=read(d,'options')['categories'][0]
    assert len(items)==2 and len(read(d,'options')['categories'])==1
    write(d,'category.save',{'name':'Renamed category','is_active':False},cat['id'],cat['version'])
    renamed=read(d,'catalog')['data'][0];assert renamed['category']=='Renamed category' and renamed['category_id']==cat['id']
    updated=write(d,'item.save',{'name':'Edited name','category_id':cat['id']},renamed['id'],renamed['version'])
    assert updated['stock_quantity']==7 and Decimal(updated['cost_price'])==Decimal('2.3456') and updated['sku']=='legacy-code'
    with pytest.raises(psycopg.Error,match='DUPLICATE_CODE'):write(d,'item.save',{'name':'New','sku':' LEGACY-CODE '})

def test_service_never_creates_stock_or_appears_in_low_stock(managed):
    item=write(managed,'item.save',{'name':'Repair','item_type':'SERVICE','unit_price':'100','billing_unit':'hour','duration':30})
    assert item['track_stock'] is False and item['stock_quantity']==0
    assert read(managed,'catalog',{'low_stock':True})['total']==0
    with psycopg.connect(URL) as c:assert c.execute('SELECT count(*) FROM inventory_movements').fetchone()[0]==0
    with pytest.raises(psycopg.Error,match='TRACKED_PRODUCT_REQUIRED'):write(managed,'stock.adjust',{'delta':1,'reason':'Invalid','entry_date':'2026-02-10'},item['id'],1)

def test_retry_conflict_is_not_silently_overwritten(managed):
    key=uuid4();first=write(managed,'item.save',{'name':'Once'},key=key)
    repeated=write(managed,'item.save',{'name':'Once'},key=key)
    assert repeated['id']==first['id'] and repeated['replayed']
    with pytest.raises(psycopg.Error,match='REQUEST_KEY_REUSED'):write(managed,'item.save',{'name':'Different'},key=key)
    assert read(managed,'catalog')['total']==1

def test_cross_business_items_categories_and_members_are_rejected(managed):
    d=managed;foreign=uuid4();user=uuid4();category=uuid4();item=uuid4()
    with psycopg.connect(URL) as c:
        c.execute('INSERT INTO businesses(id,name) VALUES(%s,%s)',(foreign,'Other'))
        c.execute("INSERT INTO memberships(business_id,user_id,role) VALUES(%s,%s,'owner')",(foreign,user))
        c.execute("INSERT INTO catalog_categories(id,business_id,item_type,name) VALUES(%s,%s,'PRODUCT','Foreign')",(category,foreign))
        c.execute("INSERT INTO catalog_items(id,business_id,name,item_type,unit_price) VALUES(%s,%s,'Foreign','PRODUCT',10)",(item,foreign))
    with pytest.raises(psycopg.Error,match='CATEGORY_INVALID'):write(d,'item.save',{'name':'Sneaky','category_id':str(category)})
    with pytest.raises(psycopg.Error,match='ITEM_NOT_FOUND'):write(d,'item.save',{'name':'Sneaky'},item,1)
    with pytest.raises(psycopg.Error,match='VERSION_CONFLICT'):write(d,'member.save',{'name':'Sneaky','role':'admin'},user,1)
    assert read(d,'catalog')['total']==0
    assert read(d,'users')['total']==1

def test_editor_can_create_but_cannot_edit_or_manage_users(managed):
    d=managed;editor=uuid4()
    with psycopg.connect(URL) as c:c.execute("INSERT INTO memberships(business_id,user_id,role) VALUES(%s,%s,'editor')",(d[1],editor))
    item=write(d,'item.save',{'name':'Editor-created'},actor=editor)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):write(d,'item.save',{'name':'Unauthorized'},item['id'],1,actor=editor)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):read(d,'users',actor=editor)
    changed=write(d,'item.save',{'name':'Owner-edited'},item['id'],1)
    assert changed['created_by']==str(editor) and changed['updated_by']==str(d[2])

def test_historical_invoice_values_and_item_structure_are_preserved(managed):
    d=managed;item=write(d,'item.save',{'name':'Original','unit_price':'100'})
    with psycopg.connect(URL) as c:
        c.execute('ALTER TABLE public.invoice_items DISABLE TRIGGER accounting_cutover_guard')
        c.execute("INSERT INTO invoice_items(id,business_id,catalog_item_id,description,quantity,unit_price,line_total) VALUES(%s,%s,%s,'Original',2,100,200)",(uuid4(),d[1],item['id']))
        c.execute('ALTER TABLE public.invoice_items ENABLE TRIGGER accounting_cutover_guard')
    updated=write(d,'item.save',{'name':'Current','unit_price':'150'},item['id'],1)
    assert updated['structure_locked']
    with pytest.raises(psycopg.Error,match='ITEM_STRUCTURE_LOCKED'):write(d,'item.save',{'unit_of_measure':'pack'},item['id'],2)
    with pytest.raises(psycopg.Error,match='ITEM_STRUCTURE_LOCKED'):write(d,'item.save',{'item_type':'SERVICE'},item['id'],2)
    with psycopg.connect(URL) as c:assert c.execute('SELECT description,unit_price,line_total FROM invoice_items').fetchone()==('Original',100,200)

def test_native_browser_opening_stock_and_on_hand_cost_edits_are_rejected(managed):
    d=managed
    with pytest.raises(psycopg.Error,match='USE_ACCOUNTING_API'):write(d,'item.save',{'name':'Cannot bypass','cost_price':'20','opening_quantity':3})
    first=native(d,CatalogMutation(request_key=uuid4(),operation='item.save',details={'name':'Stocked','cost_price':'20','opening_quantity':3,'opening_date':f'{d[6]}-02-10'}))
    with pytest.raises(psycopg.Error,match='COST_REVALUATION_REQUIRED'):write(d,'item.save',{'cost_price':'1'},first['id'],1)

def test_closed_native_period_rolls_back_source_movement_audit_and_request(managed):
    from fastapi import HTTPException
    d=managed
    with psycopg.connect(URL) as c:c.execute("UPDATE accounting.reporting_period SET status='CLOSED'")
    with pytest.raises(HTTPException):native(d,CatalogMutation(request_key=uuid4(),operation='item.save',details={'name':'Blocked','cost_price':'0','opening_quantity':3,'opening_date':f'{d[6]}-02-10'}))
    with psycopg.connect(URL) as c:
        for table in ['catalog_items','inventory_movements','management_private.requests','management_private.audit','accounting.document_map']:
            assert c.execute('SELECT count(*) FROM '+table).fetchone()[0]==0

def test_signins_and_usage_use_only_saved_scoped_events(managed):
    d=managed;foreign=uuid4()
    with psycopg.connect(URL) as c:
        for actor in [d[2],foreign]:c.execute('INSERT INTO auth.audit_log_entries(id,payload) VALUES(%s,%s)',(uuid4(),Jsonb({'actor_id':str(actor),'action':'login'})))
    events=read(d,'sign-ins');assert events['total']==1 and events['data'][0]['user_id']==str(d[2])
    assert read(d,'usage')['total']==0
    write(d,'location.save',{'name':'Store'})
    usage=read(d,'usage');assert usage['total']==1 and usage['last_activity']

def test_teams_use_existing_active_business_members_and_validate_locations(managed):
    d=managed;location=write(d,'location.save',{'name':'Branch'});team=write(d,'team.save',{'name':'Branch team','location_id':location['id']})
    write(d,'team.add',{'email':'owner@example.com'},team['id'],1)
    teams=read(d,'teams')['data'];assert len(teams[0]['members'])==1
    with pytest.raises(psycopg.Error,match='ACTIVE_BUSINESS_MEMBER_REQUIRED'):write(d,'team.add',{'email':'outsider@example.com'},team['id'],2)
    write(d,'team.remove',{'email':'owner@example.com'},team['id'],2)
    assert read(d,'teams')['data'][0]['members']==[]


def test_native_catalog_request_cannot_replay_for_a_different_actor(managed):
    from fastapi import HTTPException
    d=managed;admin=uuid4();command=CatalogMutation(request_key=uuid4(),operation='item.save',details={'name':'Actor-bound'})
    native(d,command)
    with psycopg.connect(URL) as c:c.execute("INSERT INTO memberships(business_id,user_id,role) VALUES(%s,%s,'admin')",(d[1],admin))
    other=list(d);other[2]=admin
    with pytest.raises(HTTPException,match='Workflow idempotency key conflict'):native(tuple(other),command)
    assert read(d,'catalog')['total']==1

def test_legacy_opening_stock_and_untracked_sale(managed):
    d=managed
    with psycopg.connect(URL) as c:
        c.execute("UPDATE accounting.business_map SET state='staged'")
        c.execute("""ALTER TABLE transactions ALTER COLUMN id SET DEFAULT gen_random_uuid();
         ALTER TABLE transaction_items ALTER COLUMN id SET DEFAULT gen_random_uuid();
         ALTER TABLE financial_transactions ALTER COLUMN id SET DEFAULT gen_random_uuid();
         ALTER TABLE financial_transactions ADD COLUMN description text,ADD COLUMN amount numeric,ADD COLUMN type text,ADD COLUMN category text,ADD COLUMN created_by uuid,ADD COLUMN reference_type text,ADD COLUMN reference_id uuid;""")
    key=uuid4();details={'name':'Legacy stock','unit_price':'100','opening_quantity':5,'opening_date':f'{d[6]}-02-10'}
    stocked=write(d,'item.save',details,key=key);assert write(d,'item.save',details,key=key)['stock_quantity']==5
    untracked=write(d,'item.save',{'name':'Non-stock product','track_stock':False,'unit_price':'100'})
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE authenticated');c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':str(d[2])}),))
        c.execute("SELECT process_sale_safe(%s,NULL,%s,'cash',100,%s)",(d[1],Jsonb([{'id':untracked['id'],'quantity':1,'price':'100.00'}]),uuid4()))
    assert read(d,'catalog',{'low_stock':True})['total']==0
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT stock_quantity FROM catalog_items WHERE id=%s',(untracked['id'],)).fetchone()[0]==0
        assert c.execute('SELECT count(*) FROM inventory_movements').fetchone()[0]==1
        assert c.execute('SELECT count(*) FROM accounting.stock_event').fetchone()[0]==0

def test_native_services_and_untracked_products_sell_without_stock_posting(managed):
    from cacu.accounting.workflows import SaleCreate,sale_create
    d=managed
    service=write(d,'item.save',{'name':'Service','item_type':'SERVICE','unit_price':'100'})
    product=write(d,'item.save',{'name':'Untracked product','track_stock':False,'unit_price':'100'})
    with d[0].begin() as c:
        session=session_for(c,d)
        try:sale_create(session,d[2],SaleCreate(request_key=uuid4(),items=[{'item_id':service['id'],'quantity':1},{'item_id':product['id'],'quantity':1}],entry_date=f'{d[6]}-02-10',method='Cash',quoted_total='200.00'))
        finally:session.close()
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT count(*) FROM accounting.stock_event').fetchone()[0]==0
        assert c.execute('SELECT sum(stock_quantity) FROM catalog_items').fetchone()[0]==0
        assert c.execute('SELECT count(*) FROM transaction_items').fetchone()[0]==2


def test_existing_native_invoice_and_receipt_work_with_management_guard(managed):
    from cacu.accounting.workflows import InvoiceCreate,ReceiptCreate,invoice_create,receipt_create
    d=managed;item=write(d,'item.save',{'name':'Consulting','item_type':'SERVICE','unit_price':'100'})
    with d[0].begin() as c:
        session=session_for(c,d)
        try:
            invoice=invoice_create(session,d[2],InvoiceCreate(request_key=uuid4(),customer_id=d[5],invoice_number='MANAGEMENT-1',entry_date=f'{d[6]}-02-10',items=[{'catalog_item_id':item['id'],'quantity':1,'unit_price':'100.00'}]))
        finally:session.close()
    with psycopg.connect(URL) as c:invoice_id=c.execute('SELECT id FROM invoices').fetchone()[0]
    with d[0].begin() as c:
        session=session_for(c,d)
        try:receipt_create(session,d[2],ReceiptCreate(request_key=uuid4(),invoice_id=invoice_id,amount='100.00',entry_date=f'{d[6]}-02-11',method='Cash'))
        finally:session.close()
    with psycopg.connect(URL) as c:assert c.execute('SELECT status FROM invoices WHERE id=%s',(invoice_id,)).fetchone()[0]=='paid'
