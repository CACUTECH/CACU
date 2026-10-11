"""Run against a disposable database only: CACU_TEST_DATABASE_URL must end _test."""
import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import date,datetime
from decimal import Decimal
from pathlib import Path
from uuid import uuid4
import psycopg
import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import NullPool
from cacu.accounting.session import AtomicAccountingSession
from cacu.accounting.posting import PostingCommand,post_command,native_post
from cacu.accounting.reports import cash_flow,financial_summary
from python_accounting.models import Entity,Currency,Account,Assignment,Ledger
from python_accounting.transactions import JournalEntry,ClientInvoice,ClientReceipt
from fastapi import HTTPException

DSN=os.environ.get('CACU_TEST_DATABASE_URL')
pytestmark=pytest.mark.skipif(not DSN,reason='disposable Postgres test URL required')

@pytest.fixture
def database():
    from urllib.parse import urlparse
    assert DSN and urlparse(DSN).hostname in {'127.0.0.1','localhost','postgres'}, 'Refuse non-local disposable test database'
    assert DSN and DSN.rsplit('/',1)[-1].split('?')[0].endswith('_test'), 'Refuse non-test database'
    with psycopg.connect(DSN) as c:
        c.execute('DROP SCHEMA IF EXISTS accounting CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public')
        c.execute("""CREATE TABLE public.businesses(id uuid primary key,name text);
          CREATE TABLE public.memberships(business_id uuid,user_id uuid,role text);
          CREATE TABLE public.accounts(id uuid primary key,business_id uuid,name text,is_active boolean default true);
          CREATE TABLE public.customers(id uuid primary key,business_id uuid,name text);
          CREATE TABLE public.suppliers(id uuid primary key,business_id uuid,name text);
          CREATE TABLE public.catalog_items(id uuid primary key,business_id uuid,name text,stock_quantity integer,cost_price numeric(19,4),unit_price numeric(19,4),item_type text,is_active boolean default true);
          CREATE TABLE public.invoices(id uuid primary key,business_id uuid,customer_id uuid,total numeric(19,4),tax numeric(19,4),status text,updated_at timestamptz,invoice_number text,issue_date date,due_date date,subtotal numeric(19,4),notes text,type text,vat_included boolean);
          CREATE TABLE public.invoice_items(id uuid primary key,business_id uuid,invoice_id uuid,catalog_item_id uuid,quantity numeric,line_total numeric,description text,unit_price numeric);
          CREATE TABLE public.payments(id uuid primary key,business_id uuid,reference text,purpose text,invoice_id uuid,amount numeric(19,4),currency text,status text,channel text,customer_email text,initialized_by uuid,customer_id uuid);
          CREATE TABLE public.transactions(id uuid primary key,business_id uuid,customer_id uuid,created_by uuid,status text,payment_method text CHECK(payment_method IN ('cash','transfer','card')),total numeric(19,4),subtotal numeric(19,4));
          CREATE TABLE public.transaction_items(id uuid primary key,business_id uuid,transaction_id uuid,catalog_item_id uuid,description text,quantity numeric,unit_price numeric,line_total numeric);
          CREATE TABLE public.financial_transactions(id uuid primary key,business_id uuid);
          CREATE TABLE public.journal_entries(id uuid primary key,business_id uuid);
          CREATE TABLE public.journal_lines(id uuid primary key,business_id uuid);
          DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; END $$;
          CREATE FUNCTION public.is_business_member(tenant uuid) RETURNS boolean LANGUAGE sql AS $$
          SELECT EXISTS(SELECT FROM public.memberships WHERE business_id=tenant AND user_id=(current_setting('request.jwt.claims')::jsonb->>'sub')::uuid); $$;
        """)
        for p in sorted([*Path('../supabase/migrations').glob('2026101108*.sql'), *Path('../supabase/migrations').glob('20261011090*.sql')]):
            c.execute(p.read_text(encoding='utf-8-sig'))
        for migration in Path('../supabase/migrations').glob('*_native_collection_account_lock.sql'):
            c.execute(migration.read_text(encoding='utf-8'))
        for tab in ['memberships','accounts','customers','suppliers','catalog_items','invoices','invoice_items','payments','transactions','transaction_items']:
            c.execute(f'ALTER TABLE public.{tab} ENABLE ROW LEVEL SECURITY')
    engine=create_engine(DSN.replace('postgresql://','postgresql+psycopg://'),poolclass=NullPool)
    business,actor=uuid4(),uuid4();year=datetime.today().year
    with engine.begin() as c:
        c.exec_driver_sql('INSERT INTO public.businesses VALUES(%s,%s)',(str(business),'Fixture'))
        c.exec_driver_sql('INSERT INTO public.memberships VALUES(%s,%s,%s)',(str(business),str(actor),'owner'))
        c.exec_driver_sql("SELECT set_config('cacu.business_id',%s,true),set_config('search_path','accounting,public,pg_catalog',true)",(str(business),))
        s=AtomicAccountingSession(bind=c,info={'ignore_isolation':False,'include_deleted':False})
        e=Entity(name='Fixture');s.add(e);s.flush()
        currency=Currency(name='Naira',code='NGN',entity_id=e.id);s.add(currency);s.flush();e.currency_id=currency.id;s.flush()
        accounts={};party=uuid4()
        c.exec_driver_sql('INSERT INTO public.customers VALUES(%s,%s,%s)',(str(party),str(business),'Customer'))
        for name,kind,section in [('cash','BANK','cash'),('cash2','BANK','cash'),('equity','EQUITY','financing'),('inventory','INVENTORY','operating'),('ar','RECEIVABLE','operating'),('ap','PAYABLE','operating'),('revenue','OPERATING_REVENUE','operating'),('cogs','DIRECT_EXPENSE','operating'),('expense','OPERATING_EXPENSE','operating'),('fixed','NON_CURRENT_ASSET','investing'),('depreciation','CONTRA_ASSET','operating')]:
            a=Account(name=name,account_type=Account.AccountType[kind],currency_id=currency.id,entity_id=e.id);s.add(a);s.flush()
            ident=uuid4();accounts[name]=(ident,a.id)
            c.exec_driver_sql('INSERT INTO public.accounts(id,business_id,name) VALUES(%s,%s,%s)',(str(ident),str(business),name))
            c.exec_driver_sql('INSERT INTO accounting.account_map VALUES(%s,%s,%s,%s,%s)',(str(business),str(ident),a.id,section,name))
        c.exec_driver_sql("INSERT INTO accounting.party_map VALUES(%s,'customers',%s,%s)",(str(business),str(party),accounts['ar'][1]))
        c.exec_driver_sql("INSERT INTO accounting.business_map(business_id,entity_id,timezone,state,cutover_date,reconciliation_evidence) VALUES(%s,%s,'Africa/Lagos','active',%s,%s::jsonb)",(str(business),e.id,date(year,1,1),json.dumps({'fixture':True})))
        eid=e.id
        s.close()
    yield engine,business,actor,eid,accounts,party,year
    engine.dispose()

def session_for(c,d):
    _,business,actor,eid,_,_,_=d
    c.exec_driver_sql("SET LOCAL ROLE cacu_runtime")
    c.exec_driver_sql("SELECT set_config('request.jwt.claims',%s,true),set_config('cacu.business_id',%s,true),set_config('search_path','accounting,public,pg_catalog',true)",(json.dumps({'sub':str(actor)}),str(business)))
    c.exec_driver_sql('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))',(str(business),))
    c.exec_driver_sql('SELECT accounting.lock_membership(%s,%s)',(str(business),str(actor)))
    s=AtomicAccountingSession(bind=c,info={'ignore_isolation':False,'include_deleted':False});s.entity=s.get(Entity,eid);s.business_id=business;s.business_timezone='Africa/Lagos'
    return s

def command(d,kind,main,other,amount,**kw):
    _,_,_,_,accounts,party,year=d
    if kind in {'receipt','pos'}:kw.setdefault('payment_method','Cash')
    return PostingCommand(request_key=uuid4(),kind=kind,source_id=uuid4(),main_account_id=accounts[main][0],
         entry_date=date(year,2,10),narration='Fixture',lines=[{'account_id':accounts[other][0],'amount':str(amount)}],**kw)

def post(d,cmd):
    with d[0].begin() as c:
        s=session_for(c,d)
        try:return post_command(s,d[2],cmd)
        finally:s.close()

def fixture_postings(d):
    post(d,command(d,'adjustment','equity','cash','1000000'))
    post(d,command(d,'adjustment','cash','inventory','100000'))
    invoice=command(d,'invoice','ar','revenue','60000',counterparty_id=d[5])
    with d[0].begin() as c:
        # Source draft exists before cutover fixture posting. Runtime owns this write.
        s=session_for(c,d)
        c.exec_driver_sql("INSERT INTO public.invoices(id,business_id,customer_id,total,tax,status) VALUES(%s,%s,%s,60000,0,'draft')",(str(invoice.source_id),str(d[1]),str(d[5])))
        s.close()
    post(d,invoice)
    post(d,command(d,'adjustment','inventory','cogs','30000'))
    receipt=command(d,'receipt','ar','cash','30000',target_id=invoice.source_id,counterparty_id=d[5])
    result=post(d,receipt)
    post(d,command(d,'expense','cash','expense','5000'))
    return invoice,receipt,result

def test_ngn_fixture_and_partial_payment(database):
    d=database;invoice,receipt,result=fixture_postings(d)
    assert result['outstanding']=='30000.00'
    with d[0].begin() as c:
        s=session_for(c,d);report=cash_flow(s,date(d[6],1,1),date(d[6],12,31));summary=financial_summary(s,date(d[6],1,1),date(d[6],12,31))
        assert [x['total'] for x in report['sections']]==['-75000.00','0.00','1000000.00']
        assert report['closing_cash']==report['ledger_cash']=='925000.00'
        assert report['difference']=='0.00' and report['reconciled']
        assert summary['net_profit']=='25000.00' and summary['receivables']=='30000.00' and summary['inventory']=='70000.00'
        assert summary['trial_balance_difference']=='0.00'
        s.close()

def test_idempotency_and_conflict(database):
    d=database;cmd=command(d,'adjustment','equity','cash','1000')
    assert post(d,cmd)==post(d,cmd)
    cmd.lines[0].amount='2000'
    with pytest.raises(HTTPException) as error:post(d,cmd)
    assert error.value.status_code==409

def test_outer_rollback_including_upstream_commits(database):
    d=database;cmd=command(d,'adjustment','equity','cash','1000')
    with pytest.raises(RuntimeError):
        with d[0].begin() as c:
            s=session_for(c,d);post_command(s,d[2],cmd);s.close();raise RuntimeError('document failure')
    with d[0].begin() as c:
        assert c.exec_driver_sql('SELECT count(*) FROM accounting.ledger').scalar()==0
        assert c.exec_driver_sql('SELECT count(*) FROM accounting.posting_requests').scalar()==0
        assert c.exec_driver_sql('SELECT count(*) FROM accounting.audit_event').scalar()==0

def test_non_cash_purchase_and_internal_transfer(database):
    d=database
    post(d,command(d,'adjustment','equity','cash','1000'))
    post(d,command(d,'adjustment','ap','fixed','100'))
    post(d,command(d,'transfer','cash','cash2','200'))
    with d[0].begin() as c:
        s=session_for(c,d);report=cash_flow(s,date(d[6],1,1),date(d[6],12,31));s.close()
        assert [r['total'] for r in report['sections']]==['0.00','0.00','1000.00']
        assert report['closing_cash']=='1000.00' and report['reconciled']

def test_rls_wrong_tenant_and_actor(database):
    d=database
    with d[0].begin() as c:
        s=session_for(c,d)
        c.exec_driver_sql("SELECT set_config('cacu.business_id',%s,true)",(str(uuid4()),))
        assert c.exec_driver_sql('SELECT count(*) FROM accounting.account').scalar()==0
        s.close()
    with d[0].begin() as c:
        s=session_for(c,d)
        c.exec_driver_sql("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':str(uuid4())}),))
        assert c.exec_driver_sql('SELECT count(*) FROM accounting.account').scalar()==0
        s.close()

def test_concurrent_allocation_cannot_overpay(database):
    d=database;invoice,_,_=fixture_postings(d)
    cmds=[command(d,'receipt','ar','cash','20000',target_id=invoice.source_id,counterparty_id=d[5]) for _ in range(2)]
    def run(cmd):
        try:return post(d,cmd)
        except HTTPException as e:return e.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(run,cmds))
    assert sum(isinstance(r,dict) for r in results)==1 and 409 in results

def test_opening_balances_and_empty_comparison(database):
    d=database;fixture_postings(d)
    with d[0].begin() as c:
        s=session_for(c,d);report=cash_flow(s,date(d[6],3,1),date(d[6],3,31));s.close()
        assert report['opening_cash']==report['closing_cash']=='925000.00'
        assert report['net_change']=='0.00' and report['empty'] and report['reconciled']


def test_workflow_invoice_stock_payment_and_replay(database):
    from cacu.accounting.workflows import InvoiceCreate,ReceiptCreate,invoice_create,receipt_create
    d=database;item=uuid4();key=uuid4()
    with d[0].begin() as c:
        s=session_for(c,d)
        c.exec_driver_sql("INSERT INTO public.catalog_items(id,business_id,name,stock_quantity,cost_price,unit_price,item_type) VALUES(%s,%s,'Goods',10,3000,6000,'PRODUCT')",(str(item),str(d[1])))
        cmd=InvoiceCreate(request_key=key,customer_id=d[5],invoice_number='INV-TEST',entry_date=date(d[6],2,10),items=[{'catalog_item_id':item,'quantity':10,'unit_price':'6000.00'}])
        result=invoice_create(s,d[2],cmd);s.close()
    with d[0].begin() as c:
        s=session_for(c,d)
        assert invoice_create(s,d[2],cmd)==result
        assert c.exec_driver_sql('SELECT stock_quantity FROM public.catalog_items WHERE id=%s',(str(item),)).scalar()==0
        payment=ReceiptCreate(request_key=uuid4(),invoice_id=key,amount='30000.00',entry_date=date(d[6],2,11),method='Cash')
        receipt=receipt_create(s,d[2],payment)
        assert receipt['outstanding']=='30000.00'
        summary=financial_summary(s,date(d[6],1,1),date(d[6],12,31))
        assert summary['net_profit']=='30000.00'
        assert summary['balance_sheet_difference']=='0.00'
        s.close()

def test_stock_failure_rolls_back_source_and_ledger(database):
    from cacu.accounting.workflows import InvoiceCreate,invoice_create
    d=database;item=uuid4();key=uuid4()
    with d[0].begin() as c:
        s=session_for(c,d)
        c.exec_driver_sql("INSERT INTO public.catalog_items(id,business_id,name,stock_quantity,cost_price,unit_price,item_type) VALUES(%s,%s,'Goods',1,3000,6000,'PRODUCT')",(str(item),str(d[1])));s.close()
    with pytest.raises(HTTPException):
        with d[0].begin() as c:
            s=session_for(c,d)
            try:invoice_create(s,d[2],InvoiceCreate(request_key=key,customer_id=d[5],invoice_number='INV-ROLLBACK',entry_date=date(d[6],2,10),items=[{'catalog_item_id':item,'quantity':2,'unit_price':'6000.00'}]))
            finally:s.close()
    with d[0].begin() as c:
        assert c.exec_driver_sql('SELECT count(*) FROM public.invoices').scalar()==0
        assert c.exec_driver_sql('SELECT count(*) FROM accounting.ledger').scalar()==0
        assert c.exec_driver_sql('SELECT stock_quantity FROM public.catalog_items').scalar()==1

def test_supplier_bill_payment_and_depreciation(database):
    d=database
    bill=command(d,'bill','ap','fixed','1000')
    post(d,bill)
    result=post(d,command(d,'supplier_payment','ap','cash','400',target_id=bill.source_id))
    assert result['outstanding']=='600.00'
    post(d,command(d,'adjustment','depreciation','expense','100'))
    with d[0].begin() as c:
        s=session_for(c,d);report=cash_flow(s,date(d[6],1,1),date(d[6],12,31));s.close()
        assert report['reconciled'] and report['closing_cash']=='-400.00'
        assert [section['total'] for section in report['sections']]==['0.00','-400.00','0.00']

def test_posted_ledger_immutable(database):
    d=database;post(d,command(d,'adjustment','equity','cash','1000'))
    from sqlalchemy.exc import IntegrityError
    with pytest.raises(IntegrityError):
        with d[0].begin() as c:
            s=session_for(c,d)
            try:c.exec_driver_sql('UPDATE accounting.ledger SET amount=amount+1')
            finally:s.close()


def test_credit_note_and_audited_reversal(database):
    d=database;invoice,_,_=fixture_postings(d)
    result=post(d,command(d,'credit_note','ar','revenue','10000',target_id=invoice.source_id,counterparty_id=d[5]))
    assert result['outstanding']=='20000.00'
    original=command(d,'adjustment','equity','cash','1000');post(d,original)
    reversal=command(d,'reversal','equity','cash','1',target_id=original.source_id)
    reversed_result=post(d,reversal)
    assert reversed_result['amount']=='1000.00'
    with d[0].begin() as c:
        s=session_for(c,d);report=cash_flow(s,date(d[6],1,1),date(d[6],12,31));s.close()
        assert report['closing_cash']=='925000.00' and report['reconciled']
    with pytest.raises(HTTPException):post(d,command(d,'reversal','equity','cash','1',target_id=original.source_id))

def test_viewer_cannot_insert_ledger(database):
    d=database
    with d[0].begin() as c:
        c.exec_driver_sql("UPDATE public.memberships SET role='viewer'")
    from sqlalchemy.exc import ProgrammingError
    with pytest.raises(ProgrammingError):
        post(d,command(d,'adjustment','equity','cash','1000'))

def test_compound_journal_balances(database):
    d=database;accounts=d[4]
    cmd=PostingCommand(request_key=uuid4(),source_id=uuid4(),kind='adjustment',main_account_id=accounts['cash'][0],entry_date=date(d[6],2,10),narration='Compound',credited=False,main_amount='1000.00',lines=[
       {'account_id':accounts['expense'][0],'amount':'100.00','credited':False},
       {'account_id':accounts['equity'][0],'amount':'1100.00','credited':True}])
    post(d,cmd)
    with d[0].begin() as c:
        s=session_for(c,d);summary=financial_summary(s,date(d[6],1,1),date(d[6],12,31));s.close()
        assert summary['trial_balance_difference']=='0.00' and summary['cash']=='1000.00'


def test_api_to_real_postgres_and_membership_rejection(database,monkeypatch):
    from sqlalchemy import event
    from fastapi.testclient import TestClient
    import app as api
    import cacu.accounting.session as sessions
    d=database;fixture_postings(d)
    def test_engine(*args,**kwargs):
        engine=create_engine(DSN.replace('postgresql://','postgresql+psycopg://'),poolclass=NullPool)
        @event.listens_for(engine,'connect')
        def role(connection,record):
            connection.autocommit=True
            with connection.cursor() as cursor:cursor.execute('SET ROLE cacu_runtime')
            connection.autocommit=False
        return engine
    monkeypatch.setenv('CACU_DATABASE_URL',DSN);monkeypatch.setattr(sessions,'create_engine',test_engine)
    api.app.dependency_overrides[api.current_user]=lambda:d[2]
    try:
        client=TestClient(api.app)
        response=client.get(f'/api/v1/businesses/{d[1]}/reports/cash-flow',params={'start_date':f'{d[6]}-01-01','end_date':f'{d[6]}-12-31'})
        assert response.status_code==200 and response.json()['closing_cash']=='925000.00'
        response=client.get(f'/api/v1/businesses/{d[1]}/collection-accounts')
        assert response.status_code==200 and response.json()==[]
        response=client.get(f'/api/v1/businesses/{uuid4()}/collection-accounts')
        assert response.status_code==403
        response=client.get(f'/api/v1/businesses/{uuid4()}/reports/cash-flow',params={'start_date':f'{d[6]}-01-01','end_date':f'{d[6]}-12-31'})
        assert response.status_code==403
        response=client.get(f'/api/v1/businesses/{d[1]}/reports/cash-flow',params={'start_date':f'{d[6]}-12-31','end_date':f'{d[6]}-01-01'})
        assert response.status_code==422
    finally:api.app.dependency_overrides.pop(api.current_user,None)


def test_cutover_guard_preserves_legacy_browser_writes(database):
    d=database;legacy=uuid4()
    with d[0].begin() as c:
        c.exec_driver_sql('INSERT INTO public.businesses VALUES(%s,%s)',(str(legacy),'Legacy'))
        c.exec_driver_sql('GRANT USAGE ON SCHEMA public TO authenticated')
        c.exec_driver_sql('GRANT INSERT ON public.financial_transactions TO authenticated')
    with d[0].begin() as c:
        c.exec_driver_sql('SET LOCAL ROLE authenticated')
        c.exec_driver_sql('INSERT INTO public.financial_transactions VALUES(%s,%s)',(str(uuid4()),str(legacy)))
    from sqlalchemy.exc import IntegrityError
    with pytest.raises(IntegrityError):
        with d[0].begin() as c:
            c.exec_driver_sql('SET LOCAL ROLE authenticated')
            c.exec_driver_sql('INSERT INTO public.financial_transactions VALUES(%s,%s)',(str(uuid4()),str(d[1])))


# Native collection-account regression fixtures run using the restricted runtime.
def reviewed_bank(d):
    with d[0].begin() as c:
        c.exec_driver_sql("UPDATE accounting.account_map SET purpose='bank' WHERE account_id=%s",(str(d[4]['cash2'][0]),))
    return d[4]['cash2'][0]


def workflow(d,fn,data):
    with d[0].begin() as c:
        s=session_for(c,d)
        try:return fn(s,d[2],data)
        finally:s.close()


def issued_service_invoice(d):
    from cacu.accounting.workflows import InvoiceCreate,invoice_create
    item=uuid4();key=uuid4()
    with d[0].begin() as c:
        s=session_for(c,d)
        c.exec_driver_sql("INSERT INTO public.catalog_items(id,business_id,name,unit_price,item_type) VALUES(%s,%s,'Service',100,'SERVICE')",(str(item),str(d[1])))
        s.close()
    workflow(d,invoice_create,InvoiceCreate(request_key=key,customer_id=d[5],invoice_number=str(key),entry_date=date(d[6],2,10),items=[{'catalog_item_id':item,'quantity':1,'unit_price':'100.00'}]))
    return key


def cash_balance(c,library_id):
    return c.exec_driver_sql("SELECT coalesce(sum(CASE WHEN entry_type='DEBIT' THEN amount ELSE -amount END),0) FROM accounting.ledger WHERE post_account_id=%s",(library_id,)).scalar()


def test_transfer_receipt_posts_to_bank_and_replays_without_duplicate_income(database):
    from cacu.accounting.workflows import ReceiptCreate,receipt_create,bank_accounts
    d=database;bank=reviewed_bank(d);invoice=issued_service_invoice(d)
    data=ReceiptCreate(request_key=uuid4(),invoice_id=invoice,amount='40.00',entry_date=date(d[6],2,11),method='Transfer',bank_account_id=bank)
    result=workflow(d,receipt_create,data)
    assert result['outstanding']=='60.00' and result['collection_account_id']==str(bank)
    assert workflow(d,receipt_create,data)==result
    with d[0].begin() as c:
        s=session_for(c,d)
        assert bank_accounts(s)==[{'id':str(bank),'name':'cash2'}]
        assert cash_balance(c,d[4]['cash2'][1])==40 and cash_balance(c,d[4]['cash'][1])==0
        assert c.exec_driver_sql('SELECT channel FROM public.payments').scalar()=='transfer'
        assert c.exec_driver_sql("SELECT details->>'collection_account_id' FROM accounting.audit_event WHERE event='receipt'").scalar()==str(bank)
        summary=financial_summary(s,date(d[6],1,1),date(d[6],12,31));report=cash_flow(s,date(d[6],1,1),date(d[6],12,31))
        assert summary['net_profit']=='100.00' and summary['receivables']=='60.00'
        assert summary['trial_balance_difference']=='0.00' and report['closing_cash']=='40.00' and report['reconciled']
        s.close()
    data.bank_account_id=d[4]['cash'][0]
    with pytest.raises(HTTPException) as error:workflow(d,receipt_create,data)
    assert error.value.status_code==409


@pytest.mark.parametrize('variant',['missing','foreign','inactive','wrong_purpose','wrong_section','non_bank','deleted','cash_with_bank','card'])
def test_invalid_collection_selection_rolls_back_receipt(database,variant):
    from cacu.accounting.workflows import ReceiptCreate,receipt_create,bank_accounts
    d=database;bank=reviewed_bank(d);invoice=issued_service_invoice(d)
    chosen=bank;method='Transfer'
    with d[0].begin() as c:
        if variant=='missing':chosen=None
        if variant=='foreign':
            foreign=uuid4();chosen=uuid4()
            c.exec_driver_sql('INSERT INTO public.businesses VALUES(%s,%s)',(str(foreign),'Foreign'))
            c.exec_driver_sql('INSERT INTO public.accounts VALUES(%s,%s,%s,true)',(str(chosen),str(foreign),'Foreign bank'))
        if variant=='inactive':c.exec_driver_sql('UPDATE public.accounts SET is_active=false WHERE id=%s',(str(bank),))
        if variant=='wrong_purpose':c.exec_driver_sql("UPDATE accounting.account_map SET purpose='other' WHERE account_id=%s",(str(bank),))
        if variant=='wrong_section':c.exec_driver_sql("UPDATE accounting.account_map SET flow_section='restricted' WHERE account_id=%s",(str(bank),))
        if variant=='non_bank':c.exec_driver_sql("UPDATE accounting.account SET account_type='RECEIVABLE' WHERE id=%s",(d[4]['cash2'][1],))
        if variant=='deleted':c.exec_driver_sql('UPDATE accounting.recyclable SET deleted_at=now() WHERE id=%s',(d[4]['cash2'][1],))
        if variant=='cash_with_bank':method='Cash'
        if variant=='card':method='Card';chosen=None
    data=ReceiptCreate(request_key=uuid4(),invoice_id=invoice,amount='40.00',entry_date=date(d[6],2,11),method=method,bank_account_id=chosen)
    with pytest.raises(HTTPException):workflow(d,receipt_create,data)
    with d[0].begin() as c:
        s=session_for(c,d)
        assert c.exec_driver_sql('SELECT count(*) FROM public.payments').scalar()==0
        assert cash_balance(c,d[4]['cash'][1])==cash_balance(c,d[4]['cash2'][1])==0
        assert c.exec_driver_sql("SELECT count(*) FROM accounting.audit_event WHERE event='receipt'").scalar()==0
        if variant in {'foreign','missing','cash_with_bank','card'}:assert len(bank_accounts(s))==1
        else:assert bank_accounts(s)==[]
        s.close()


@pytest.mark.parametrize('method',['Cash','Transfer'])
def test_pos_uses_selected_collection_account_and_lowercase_source_method(database,method):
    from cacu.accounting.workflows import SaleCreate,sale_create
    d=database;bank=reviewed_bank(d);item=uuid4()
    with d[0].begin() as c:
        s=session_for(c,d)
        c.exec_driver_sql("INSERT INTO public.catalog_items(id,business_id,name,unit_price,cost_price,stock_quantity,item_type) VALUES(%s,%s,'Goods',100,30,10,'PRODUCT')",(str(item),str(d[1])))
        s.close()
    data=SaleCreate(request_key=uuid4(),items=[{'item_id':item,'quantity':1}],entry_date=date(d[6],2,10),method=method,quoted_total='100.00',bank_account_id=bank if method=='Transfer' else None)
    result=workflow(d,sale_create,data);assert workflow(d,sale_create,data)==result
    with d[0].begin() as c:
        s=session_for(c,d)
        assert cash_balance(c,d[4]['cash2'][1])==(100 if method=='Transfer' else 0)
        assert cash_balance(c,d[4]['cash'][1])==(100 if method=='Cash' else 0)
        assert c.exec_driver_sql('SELECT payment_method FROM public.transactions').scalar()==method.lower()
        assert c.exec_driver_sql('SELECT stock_quantity FROM public.catalog_items').scalar()==9
        assert c.exec_driver_sql('SELECT count(*) FROM public.transactions').scalar()==1
        s.close()


def test_collection_lock_blocks_deactivation_until_commit_and_hides_foreign_scope(database):
    from cacu.accounting.workflows import collection_account
    d=database;bank=reviewed_bank(d)
    from sqlalchemy.exc import OperationalError,ProgrammingError
    with d[0].begin() as locked:
        s=session_for(locked,d)
        assert collection_account(s,'Transfer',bank)==bank
        with pytest.raises(OperationalError):
            with d[0].begin() as c:
                c.exec_driver_sql("SET LOCAL lock_timeout='100ms'")
                c.exec_driver_sql('UPDATE public.accounts SET is_active=false WHERE id=%s',(str(bank),))
        s.close()
    with d[0].begin() as c:
        c.exec_driver_sql('UPDATE public.accounts SET is_active=false WHERE id=%s',(str(bank),))
    with d[0].begin() as c:
        s=session_for(c,d)
        with pytest.raises(ProgrammingError):c.exec_driver_sql('SELECT accounting.lock_collection_account(%s,%s,%s)',(str(uuid4()),str(bank),'bank'))
        s.close()


def test_collection_lock_rejects_viewer_and_has_no_browser_execution_grant(database):
    from sqlalchemy.exc import ProgrammingError
    d=database;bank=reviewed_bank(d)
    with d[0].begin() as c:
        assert not c.exec_driver_sql("SELECT has_function_privilege('authenticated','accounting.lock_collection_account(uuid,uuid,text)','EXECUTE')").scalar()
        c.exec_driver_sql("UPDATE public.memberships SET role='viewer'")
    with pytest.raises(ProgrammingError):
        with d[0].begin() as c:
            s=session_for(c,d)
            try:c.exec_driver_sql('SELECT accounting.lock_collection_account(%s,%s,%s)',(str(d[1]),str(bank),'bank'))
            finally:s.close()


def test_existing_cash_workflow_hash_replays_after_additive_bank_field(database):
    from cacu.accounting.workflows import ReceiptCreate,receipt_create
    import hashlib
    d=database;invoice=issued_service_invoice(d)
    data=ReceiptCreate(request_key=uuid4(),invoice_id=invoice,amount='40.00',entry_date=date(d[6],2,11),method='Cash')
    # Hash captured from the old API contract, which had no bank_account_id field.
    previous=data.model_dump(mode='json');previous.pop('bank_account_id')
    digest=hashlib.sha256(('receipt'+json.dumps(previous,sort_keys=True,separators=(',',':'))).encode()).hexdigest()
    original={'source_id':str(data.request_key),'outstanding':'60.00'}
    with d[0].begin() as c:
        s=session_for(c,d)
        c.exec_driver_sql('INSERT INTO accounting.workflow_request VALUES(%s,%s,%s,%s::jsonb)',(str(d[1]),str(data.request_key),digest,json.dumps(original)))
        s.close()
    assert workflow(d,receipt_create,data)==original
    with d[0].begin() as c:assert c.exec_driver_sql('SELECT count(*) FROM public.payments').scalar()==0


@pytest.mark.parametrize('variant',['missing_method','cash_bank_mismatch'])
def test_direct_posting_cannot_bypass_collection_classification(database,variant):
    d=database;bank=reviewed_bank(d);invoice=issued_service_invoice(d)
    data=command(d,'receipt','ar','cash2','40',target_id=invoice,counterparty_id=d[5],payment_method=None if variant=='missing_method' else 'Cash')
    with pytest.raises(HTTPException) as error:post(d,data)
    assert error.value.status_code==422
    with d[0].begin() as c:
        assert c.exec_driver_sql('SELECT count(*) FROM public.payments').scalar()==0
        assert cash_balance(c,d[4]['cash2'][1])==0
