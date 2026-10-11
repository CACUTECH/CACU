"""Legacy sales/receipts on disposable PostgreSQL; no production credentials."""
import json, os
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor
import psycopg
import pytest
DSN=os.getenv('CACU_TEST_DATABASE_URL')
pytestmark=pytest.mark.skipif(not DSN,reason='Disposable PostgreSQL required')

@pytest.fixture
def db():
 p=urlparse(DSN);assert p.hostname in {'127.0.0.1','localhost','postgres'} and p.path.endswith('_test')
 actor,biz,foreign,customer,other_customer,sku,other_sku,service,invoice=[uuid4() for _ in range(9)]
 with psycopg.connect(DSN) as c:
  c.execute('DROP SCHEMA IF EXISTS legacy_private CASCADE; DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE SCHEMA auth')
  c.execute("""DO $$ BEGIN
   IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
   IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  END $$;
  CREATE TYPE public.membership_role AS ENUM ('owner','admin','editor','viewer');
  CREATE TABLE businesses(id uuid PRIMARY KEY);
  CREATE TABLE memberships(business_id uuid,user_id uuid,role public.membership_role);
  CREATE TABLE customers(id uuid PRIMARY KEY,business_id uuid,email text);
  CREATE TABLE catalog_items(id uuid PRIMARY KEY,business_id uuid,name text,unit_price numeric(19,2),stock_quantity integer CHECK(stock_quantity>=0),item_type text,is_active boolean,updated_at timestamptz);
  CREATE TABLE transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid,customer_id uuid,created_by uuid,status text CHECK(status IN ('completed','voided','refunded')),payment_method text CHECK(payment_method IN ('cash','transfer','card')),subtotal numeric,total numeric);
  CREATE TABLE transaction_items(business_id uuid,transaction_id uuid,catalog_item_id uuid,description text,quantity numeric,unit_price numeric,line_total numeric);
  CREATE TABLE invoices(id uuid PRIMARY KEY,business_id uuid,customer_id uuid,total numeric,type text,status text CHECK(status IN ('draft','sent','paid','overdue','void')),updated_at timestamptz);
  CREATE TABLE payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid,purpose text NOT NULL CHECK(purpose='invoice'),invoice_id uuid,customer_id uuid,amount numeric CHECK(amount>0),currency text,channel text,reference text NOT NULL UNIQUE,status text,customer_email text NOT NULL,initialized_by uuid,initialized_at timestamptz,verified_at timestamptz);
  CREATE TABLE financial_transactions(business_id uuid,description text,amount numeric,type text,category text,created_by uuid,reference_type text,reference_id uuid);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
  CREATE FUNCTION public.has_business_role(b uuid,roles public.membership_role[]) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT EXISTS(SELECT FROM public.memberships WHERE business_id=b AND user_id=auth.uid() AND role=ANY(roles)) $$;
  GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
  """)
  c.execute('INSERT INTO businesses VALUES(%s),(%s)',(biz,foreign))
  c.execute("INSERT INTO memberships VALUES(%s,%s,'owner')",(biz,actor))
  c.execute("INSERT INTO customers VALUES(%s,%s,'test@example.com'),(%s,%s,'foreign@example.com')",(customer,biz,other_customer,foreign))
  for item,tenant,kind,stock in [(sku,biz,'PRODUCT',2),(other_sku,foreign,'PRODUCT',2),(service,biz,'SERVICE',None)]:
   c.execute('INSERT INTO catalog_items VALUES(%s,%s,%s,100,%s,%s,true,now())',(item,tenant,'Server name',stock,kind))
  c.execute("INSERT INTO invoices VALUES(%s,%s,%s,100,'Invoice','sent',now())",(invoice,biz,customer))
  c.execute(next(Path('../supabase/migrations').glob('*_legacy_financial_integrity.sql')).read_text(encoding='utf-8'))
 return dict(zip(['actor','biz','foreign','customer','other_customer','sku','other_sku','service','invoice'],[actor,biz,foreign,customer,other_customer,sku,other_sku,service,invoice]))

def sale(d,items=None,total=100,key=None,customer=None,method='Cash'):
 with psycopg.connect(DSN) as c:
  c.execute('SET ROLE authenticated');c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':str(d['actor'])}),))
  return c.execute('SELECT public.process_sale_safe(%s,%s,%s::jsonb,%s,%s,%s)',(d['biz'],customer,json.dumps(items or [{'id':str(d['sku']),'quantity':1,'price':'100.00','name':'Forged name'}]),method,total,key or uuid4())).fetchone()[0]

def receipt(d,amount=40,reference=None,invoice=None,customer=None,method='Cash'):
 with psycopg.connect(DSN) as c:
  c.execute('SET ROLE authenticated');c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':str(d['actor'])}),))
  return c.execute('SELECT public.record_payment_atomic(%s,%s,%s,%s,%s,%s)',(d['biz'],invoice or d['invoice'],customer,amount,method,reference or str(uuid4()))).fetchone()[0]

def test_sale_authoritative_name_prices_and_replay(db):
 key=uuid4();ident=sale(db,key=key);assert sale(db,key=key)==ident
 with psycopg.connect(DSN) as c:
  assert c.execute('SELECT stock_quantity FROM catalog_items WHERE id=%s',(db['sku'],)).fetchone()[0]==1
  assert c.execute('SELECT description,unit_price,line_total FROM transaction_items').fetchone()==('Server name',100,100)
  assert c.execute('SELECT count(*),sum(amount) FROM financial_transactions').fetchone()==(1,100)
 with pytest.raises(psycopg.Error):sale(db,total=200,key=key)

@pytest.mark.parametrize('variant',['foreign_sku','foreign_customer','price','total','quantity','duplicates','card'])
def test_sale_rejects_tampering_without_writes(db,variant):
 items=[{'id':str(db['sku']),'quantity':1,'price':'100.00'}];args={}
 if variant=='foreign_sku':items[0]['id']=str(db['other_sku'])
 if variant=='foreign_customer':args['customer']=db['other_customer']
 if variant=='price':items[0]['price']='1.00'
 if variant=='total':args['total']=1
 if variant=='quantity':items[0]['quantity']=-1
 if variant=='duplicates':items*=2
 if variant=='card':args['method']='Card'
 with pytest.raises(psycopg.Error):sale(db,items=items,**args)
 with psycopg.connect(DSN) as c:
  assert c.execute('SELECT count(*) FROM transactions').fetchone()[0]==0
  assert c.execute('SELECT stock_quantity FROM catalog_items WHERE id=%s',(db['sku'],)).fetchone()[0]==2

def test_service_does_not_decrement_stock(db):
 sale(db,items=[{'id':str(db['service']),'quantity':2,'price':'100.00'}],total=200)
 with psycopg.connect(DSN) as c:assert c.execute('SELECT stock_quantity FROM catalog_items WHERE id=%s',(db['service'],)).fetchone()[0] is None

def test_stock_race_cannot_oversell(db):
 with psycopg.connect(DSN) as c:c.execute('UPDATE catalog_items SET stock_quantity=1 WHERE id=%s',(db['sku'],))
 def attempt(_):
  try:sale(db);return True
  except psycopg.Error:return False
 with ThreadPoolExecutor(2) as pool:assert sorted(pool.map(attempt,range(2)))==[False,True]

def test_partial_payment_and_replay_then_full_settlement(db):
 key=str(uuid4());ident=receipt(db,reference=key);assert receipt(db,reference=key)==ident
 with psycopg.connect(DSN) as c:
  assert c.execute('SELECT status FROM invoices').fetchone()[0]=='sent'
  assert c.execute('SELECT count(*),sum(amount) FROM payments').fetchone()==(1,40)
 with pytest.raises(psycopg.Error):receipt(db,amount=41,reference=key)
 receipt(db,amount=60)
 with psycopg.connect(DSN) as c:
  assert c.execute('SELECT status FROM invoices').fetchone()[0]=='paid'
  assert c.execute('SELECT count(*),sum(amount) FROM financial_transactions').fetchone()==(2,100)
 with pytest.raises(psycopg.Error):receipt(db,amount=1)

@pytest.mark.parametrize('variant',['foreign_invoice','foreign_customer','overpayment','zero','precision','card','draft'])
def test_invalid_receipt_writes_nothing(db,variant):
 args={}
 if variant=='foreign_invoice':
  args['invoice']=uuid4()
  with psycopg.connect(DSN) as c:
   c.execute("INSERT INTO invoices VALUES(%s,%s,%s,100,'Invoice','sent',now())",(args['invoice'],db['foreign'],db['other_customer']))
 if variant=='foreign_customer':args['customer']=db['other_customer']
 if variant=='overpayment':args['amount']=101
 if variant=='zero':args['amount']=0
 if variant=='precision':args['amount']='1.001'
 if variant=='card':args['method']='Card'
 if variant=='draft':
  with psycopg.connect(DSN) as c:c.execute("UPDATE invoices SET status='draft'")
 with pytest.raises(psycopg.Error):receipt(db,**args)
 with psycopg.connect(DSN) as c:assert c.execute('SELECT count(*) FROM payments').fetchone()[0]==0

def test_concurrent_receipts_cannot_exceed_outstanding(db):
 def attempt(_):
  try:receipt(db,amount=60);return True
  except psycopg.Error:return False
 with ThreadPoolExecutor(2) as pool:assert sorted(pool.map(attempt,range(2)))==[False,True]

def test_viewer_cannot_write_or_read_replay_table(db):
 with psycopg.connect(DSN) as c:c.execute("UPDATE memberships SET role='viewer'")
 with pytest.raises(psycopg.Error):sale(db)
 with pytest.raises(psycopg.Error):receipt(db)
 with psycopg.connect(DSN) as c:
  c.execute('SET ROLE authenticated')
  with pytest.raises(psycopg.errors.InsufficientPrivilege):c.execute('SELECT * FROM legacy_private.sale_requests')


def test_balances_include_partial_receipts_and_deny_foreign_business(db):
 receipt(db,amount=40)
 with psycopg.connect(DSN) as c:
  c.execute('SET ROLE authenticated')
  c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':str(db['actor'])}),))
  row=c.execute('SELECT * FROM public.legacy_invoice_balances(%s)',(db['biz'],)).fetchone()
  assert row==(db['invoice'],'100','60')
  with pytest.raises(psycopg.errors.InsufficientPrivilege):
   c.execute('SELECT * FROM public.legacy_invoice_balances(%s)',(db['foreign'],))

@pytest.mark.parametrize('operation',['sale','receipt'])
def test_late_failure_rolls_back_all_financial_and_inventory_writes(db,operation):
 with psycopg.connect(DSN) as c:
  c.execute("CREATE FUNCTION reject_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Simulated posting failure'; END $$; CREATE TRIGGER reject_event BEFORE INSERT ON financial_transactions FOR EACH ROW EXECUTE FUNCTION reject_event()")
 with pytest.raises(psycopg.Error):
  sale(db) if operation=='sale' else receipt(db)
 with psycopg.connect(DSN) as c:
  for table in ['transactions','transaction_items','payments','financial_transactions','legacy_private.sale_requests']:
   assert c.execute('SELECT count(*) FROM '+table).fetchone()[0]==0
  assert c.execute('SELECT stock_quantity FROM catalog_items WHERE id=%s',(db['sku'],)).fetchone()[0]==2
  assert c.execute('SELECT status FROM invoices').fetchone()[0]=='sent'

def test_concurrent_identical_sale_key_posts_once(db):
 key=uuid4()
 with ThreadPoolExecutor(2) as pool:ids=list(pool.map(lambda _:sale(db,key=key),range(2)))
 assert ids[0]==ids[1]
 with psycopg.connect(DSN) as c:assert c.execute('SELECT count(*) FROM transactions').fetchone()[0]==1


def test_committed_sale_replay_survives_price_changes_but_not_revocation(db):
 key=uuid4();ident=sale(db,key=key)
 with psycopg.connect(DSN) as c:c.execute('UPDATE catalog_items SET unit_price=200 WHERE id=%s',(db['sku'],))
 assert sale(db,key=key)==ident
 with psycopg.connect(DSN) as c:c.execute('DELETE FROM memberships')
 with pytest.raises(psycopg.errors.InsufficientPrivilege):sale(db,key=key)


def test_anonymous_cannot_execute_financial_functions(db):
 with psycopg.connect(DSN) as c:
  for function in ['public.process_sale_safe(uuid,uuid,jsonb,text,numeric,uuid)', 'public.process_sale(uuid,uuid,jsonb,text,numeric)', 'public.record_payment_atomic(uuid,uuid,uuid,numeric,text,text)', 'public.legacy_invoice_balances(uuid)']:
   assert not c.execute("SELECT has_function_privilege('anon',%s,'EXECUTE')",(function,)).fetchone()[0]
