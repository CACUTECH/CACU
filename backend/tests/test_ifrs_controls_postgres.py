"""IFRS controls on a disposable local database, never production."""
from datetime import date,timedelta
from decimal import Decimal as D
from uuid import uuid4
import json
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.accounts import AccountCreate,account_create
from cacu.accounting.catalog import CatalogMutation,catalog_mutate
from cacu.accounting.inventory import (InventoryPolicy,AdoptItem,GoodsReceipt,NrvAssessment,StockReturn,
    set_policy,adopt,receipt,assess_nrv,restore_return,overview)
from cacu.accounting.cash_rules import CashClassification,save_classification
from cacu.accounting.posting import PostingCommand,post_command
from cacu.accounting.reports import cash_flow,trial_balance
from cacu.accounting.close import CloseDraft,Approval,save_close,load_close,approve_close,GAPS,fingerprint
from cacu.accounting.workflows import InvoiceCreate,invoice_create
from test_corrections_postgres import live,call,expense,adjustment,balance
from test_opening_position_postgres import books
from test_default_chart_postgres import charted
from test_legacy_write_boundary_postgres import boundary
from test_management_postgres import managed,database,URL
from test_activation_postgres import TODAY
pytestmark=pytest.mark.skipif(not URL,reason='Isolated PostgreSQL required')


def setup_inventory(live):
    acc=call(live,'owner',lambda s,a:account_create(s,a,AccountCreate(request_key=uuid4(),kind='current_asset',name='Inventory NRV allowance')))
    policy=InventoryPolicy(request_key=uuid4(),formula='moving_weighted_average',allowance_account_id=acc['id'],evidence='Accountant approved interchangeable goods policy REF-01')
    call(live,'owner',lambda s,a:set_policy(s,a,policy))
    product=call(live,'owner',lambda s,a:catalog_mutate(s,a,CatalogMutation(request_key=uuid4(),operation='item.save',details={'name':'Valued widget','unit_price':'200','cost_price':'0','opening_quantity':0})))
    adoption=AdoptItem(request_key=uuid4(),item_id=product['id'],expected_version=product['version'],entry_date=TODAY,evidence='Opening zero units reconciled to ledger REF-02')
    call(live,'owner',lambda s,a:adopt(s,a,adoption))
    return product['id'],acc['id']


def goods(live,item,cost,qty=1,**extra):
    return GoodsReceipt(request_key=uuid4(),supplier_id=live.ids['supplier'],bill_number='GR-'+str(uuid4()),entry_date=TODAY,
        lines=[{'item_id':item,'quantity':qty,'purchase_cost':cost,**extra}],evidence='Matched supplier invoice and received quantity REF-03')


def test_weighted_cost_nrv_sale_return_and_reversal_cap(live):
    item,allowance=setup_inventory(live)
    # Supplier fixture names are intentionally discovered, not guessed.
    with psycopg.connect(URL) as c:
        supplier=c.execute('SELECT id FROM suppliers WHERE business_id=%s LIMIT 1',(live.business,)).fetchone()[0]
    live.ids['supplier']=supplier
    journal_key=uuid4()
    with pytest.raises(HTTPException,match='valuation workflows'):
        call(live,'owner',lambda s,a:post_command(s,a,PostingCommand(request_key=journal_key,source_id=journal_key,kind='adjustment',main_account_id=live.codes['1200'],entry_date=TODAY,narration='Manual inventory bypass attempt',credited=False,lines=[{'account_id':live.codes['4900'],'amount':'1','credited':True}])))
    first=goods(live,item,'100');result=call(live,'owner',lambda s,a:receipt(s,a,first))
    assert call(live,'owner',lambda s,a:receipt(s,a,first))==result
    call(live,'owner',lambda s,a:receipt(s,a,goods(live,item,'140',landed_cost='20')))
    assessment=NrvAssessment(request_key=uuid4(),item_id=item,entry_date=TODAY,estimated_selling_total='220',completion_and_selling_costs='20',evidence='Observed selling prices less completion and selling costs REF-04')
    result=call(live,'owner',lambda s,a:assess_nrv(s,a,assessment))
    assert (result['gross_cost'],result['allowance'],result['carrying_amount'])==('260.00','60.00','200.00')
    from cacu.accounting.reports import financial_summary
    summary=call(live,'viewer',lambda s,a:financial_summary(s,TODAY,TODAY))
    assert summary['inventory_allowance']=='60.00' and D(summary['inventory_gross'])-D(summary['inventory'])==D('60.00')
    invoice=InvoiceCreate(request_key=uuid4(),customer_id=live.ids['ada'],invoice_number='IFRS-'+str(uuid4()),entry_date=TODAY,
        performance_evidence='Delivery accepted by customer REF-05',items=[{'catalog_item_id':item,'quantity':1,'unit_price':'200'}])
    call(live,'owner',lambda s,a:invoice_create(s,a,invoice))
    view=call(live,'viewer',lambda s,a:overview(s));widget=next(r for r in view['items'] if r['id']==item)
    assert (widget['quantity'],widget['gross_cost'],widget['allowance'])==(1,'130.00','30.00')
    ret=StockReturn(request_key=uuid4(),item_id=item,original_source_id=invoice.request_key,quantity=1,entry_date=TODAY,evidence='Customer return received in saleable condition REF-06')
    call(live,'owner',lambda s,a:restore_return(s,a,ret))
    with pytest.raises(HTTPException,match='Quantity exceeds'):
        call(live,'owner',lambda s,a:restore_return(s,a,ret.model_copy(update={'request_key':uuid4()})))
    recover=assessment.model_copy(update={'request_key':uuid4(),'estimated_selling_total':'999'})
    result=call(live,'owner',lambda s,a:assess_nrv(s,a,recover))
    assert result['allowance']=='0.00' and result['carrying_amount']=='260.00'
    assert balance(live,'5000')==0 and balance(live,'5100')==0
    controls=call(live,'viewer',lambda s,a:trial_balance(s,TODAY))
    assert controls['exceptions']==[]
    # Quantity-only adjustments use exact adopted values and cannot undo NRV journals.
    with psycopg.connect(URL) as c:
        version=c.execute('SELECT version FROM catalog_items WHERE id=%s',(item,)).fetchone()[0]
    from cacu.accounting.stock import AdjustmentRequest,request_adjustment
    adjusted=call(live,'owner',lambda s,a:request_adjustment(s,a,AdjustmentRequest(request_key=uuid4(),item_id=item,expected_version=version,delta=-1,entry_date=TODAY,reason='Damaged unit')))
    assert adjusted['adjustment']['value']=='130.00'
    with psycopg.connect(URL) as c:
        assert adjusted['item']['version']==c.execute('SELECT version FROM catalog_items WHERE id=%s',(item,)).fetchone()[0]


def test_cash_gross_flows_interest_accrual_and_restricted_eligibility(live):
    def journal(main,other,amount,credited):
        key=uuid4()
        return PostingCommand(request_key=key,source_id=key,kind='adjustment',entry_date=TODAY,narration='IFRS cash acceptance',main_account_id=live.codes[main],credited=credited,lines=[{'account_id':live.codes[other],'amount':amount,'credited':not credited}])
    call(live,'owner',lambda s,a:post_command(s,a,journal('2500','1010','100',True)))
    call(live,'owner',lambda s,a:post_command(s,a,journal('2500','1010','40',False)))
    call(live,'owner',lambda s,a:save_classification(s,a,CashClassification(request_key=uuid4(),account_id=live.codes['7000'],effective_from=TODAY,nature='interest_paid',section='operating',evidence='IAS 7 pre-IFRS18 operating-interest policy approved REF-07')))
    call(live,'owner',lambda s,a:post_command(s,a,journal('7000','1010','10',False)))
    call(live,'owner',lambda s,a:post_command(s,a,journal('7000','2400','5',False)))
    r=call(live,'viewer',lambda s,a:cash_flow(s,TODAY,TODAY))
    financing=next(v for v in r['sections'] if v['key']=='financing')
    assert sorted(l['amount'] for l in financing['lines'])==['-40.00','100.00']
    op=next(v for v in r['sections'] if v['key']=='operating')
    assert next(v for v in op['lines'] if v['label']=='Interest paid')['amount']=='-10.00'
    assert r['reconciled'] and r['financing_reconciliation'][0]['cash_movements']=='60.00'
    bank=live.codes['1010']
    with psycopg.connect(URL) as c:c.execute("UPDATE accounting.account_map SET flow_section='restricted' WHERE business_id=%s AND account_id=%s",(live.business,bank))
    with pytest.raises(HTTPException,match='Restricted balances'):
        call(live,'viewer',lambda s,a:cash_flow(s,TODAY,TODAY))
    call(live,'owner',lambda s,a:save_classification(s,a,CashClassification(request_key=uuid4(),account_id=bank,effective_from=TODAY,section='cash',cash_eligible=True,restricted=True,evidence='Demand deposit remains available on demand; restriction reviewed REF-08')))
    r=call(live,'viewer',lambda s,a:cash_flow(s,TODAY,TODAY))
    assert r['reconciled'] and any(v['restricted'] for v in r['cash_components'])


def draft():
    return CloseDraft(request_key=uuid4(),start_date=TODAY,end_date=TODAY,annual=False,accountant_name='Test Accountant',accountant_review_evidence='Signed external schedules review reference TEST-09',
        notes={k:{'applicable':False,'assessment':'Reviewed scope; no relevant transaction for this synthetic test.','evidence':'Signed applicability assessment TEST-10'} for k in GAPS})


def test_close_has_reconciliation_issues_and_no_fabricated_approval(live):
    data=draft()
    saved=call(live,'editor',lambda s,a:save_close(s,a,data))
    assert saved['issues'] and not saved['ready_for_owner_approval']
    assert saved['comprehensive_income']['other_comprehensive_income']==['0.00','0.00']
    loaded=call(live,'viewer',lambda s,a:load_close(s,data.request_key))
    assert loaded['review_status']=='review_required' and loaded['approval'] is None
    with pytest.raises(HTTPException,match='Resolve all'):
        call(live,'owner',lambda s,a:approve_close(s,a,data.request_key,Approval(evidence='Owner reviewed synthetic test evidence')))
    before=call(live,'viewer',lambda s,a:fingerprint(s,TODAY))
    from cacu.accounting.workflows import expense_create
    call(live,'owner',lambda s,a:expense_create(s,a,expense(live)))
    after=call(live,'viewer',lambda s,a:fingerprint(s,TODAY))
    assert before!=after
    loaded=call(live,'viewer',lambda s,a:load_close(s,data.request_key))
    assert any(i['check']=='stale_review' for i in loaded['issues'])
    replayed=call(live,'editor',lambda s,a:save_close(s,a,data))
    assert replayed['id']==loaded['id'] and not replayed['ready_for_owner_approval']
    assert any(i['check']=='stale_review' for i in replayed['issues'])


def test_unsupported_revenue_and_editor_policy_are_refused(live):
    item,_=setup_inventory(live)
    advanced=InvoiceCreate(request_key=uuid4(),customer_id=live.ids['ada'],invoice_number='ADV-01',entry_date=TODAY,performance_status='not_satisfied',items=[{'catalog_item_id':item,'quantity':1,'unit_price':'200'}])
    with pytest.raises(HTTPException,match='Issue invoices only'):
        call(live,'owner',lambda s,a:invoice_create(s,a,advanced))
    with pytest.raises(HTTPException,match='Owner or Admin'):
        call(live,'editor',lambda s,a:adopt(s,a,AdoptItem(request_key=uuid4(),item_id=item,expected_version=1,entry_date=TODAY,evidence='Editor cannot approve adoption')))
    future=draft().model_copy(update={'early_ifrs18':True})
    saved=call(live,'owner',lambda s,a:save_close(s,a,future))
    assert any(i['check']=='FUTURE-01' for i in saved['issues'])



def test_independent_close_approval_and_tenant_isolation(database):
    from types import SimpleNamespace
    from test_library_postgres import session_for
    engine,tenant,owner,entity,accounts,party,year=database
    editor,admin=uuid4(),uuid4()
    with psycopg.connect(URL) as c:
        c.execute('ALTER TABLE public.accounts ADD COLUMN code text')
        c.execute("INSERT INTO memberships VALUES(%s,%s,'editor'),(%s,%s,'admin')",(tenant,editor,tenant,admin))
        # Both compared periods have approved ledger coverage in this synthetic fixture.
        c.execute('UPDATE accounting.business_map SET cutover_date=%s WHERE business_id=%s',(date(year-1,1,1),tenant))
    scope=SimpleNamespace(engine=engine,business=tenant,entity=entity,people={'owner':owner,'editor':editor,'admin':admin})
    data=draft().model_copy(update={'compare':'prior'})
    for key in ('PRES-01','IAS7-01','IAS7-04','FX-01','NOTES-01'):data.notes[key].applicable=True
    saved=call(scope,'editor',lambda s,a:save_close(s,a,data))
    assert saved['issues']==[] and saved['ready_for_owner_approval']
    with pytest.raises(HTTPException,match='Owner or Admin'):
        call(scope,'editor',lambda s,a:approve_close(s,a,data.request_key,Approval(evidence='Editor cannot approve a close')))
    approved=call(scope,'owner',lambda s,a:approve_close(s,a,data.request_key,Approval(evidence='Independent Owner signed accountant review TEST-11')))
    assert approved['review_status']=='approved' and approved['approval']['approved_by']==str(owner)
    assert call(scope,'viewer' if 'viewer' in scope.people else 'editor',lambda s,a:load_close(s,data.request_key))['review_status']=='approved'
    self_submitted=data.model_copy(update={'request_key':uuid4()})
    call(scope,'owner',lambda s,a:save_close(s,a,self_submitted))
    with pytest.raises(HTTPException,match='independent'):
        call(scope,'owner',lambda s,a:approve_close(s,a,self_submitted.request_key,Approval(evidence='Owner must not approve own submission')))
    with engine.begin() as c:
        session=session_for(c,(engine,tenant,owner,entity,None,None,year))
        c.exec_driver_sql("SELECT set_config('cacu.business_id',%s,true)",(str(uuid4()),))
        for table in ('reporting_close','reporting_close_decision','inventory_policy','inventory_valuation','inventory_value_event','cash_flow_classification','inventory_journal'):
            assert c.exec_driver_sql(f'SELECT count(*) FROM accounting.{table}').scalar()==0
        session.close()


def test_full_paid_invoice_return_refunds_cash_atomically(live):
    from cacu.accounting.workflows import ReceiptCreate,receipt_create
    item,_=setup_inventory(live)
    call(live,'owner',lambda s,a:receipt(s,a,goods(live,item,'100',qty=3)))
    invoice=InvoiceCreate(request_key=uuid4(),customer_id=live.ids['ada'],invoice_number='PAID-'+str(uuid4()),entry_date=TODAY,items=[{'catalog_item_id':item,'quantity':1,'unit_price':'200'}])
    call(live,'owner',lambda s,a:invoice_create(s,a,invoice))
    call(live,'owner',lambda s,a:receipt_create(s,a,ReceiptCreate(request_key=uuid4(),invoice_id=invoice.request_key,amount='200',entry_date=TODAY,method='Cash')))
    ret=StockReturn(request_key=uuid4(),item_id=item,original_source_id=invoice.request_key,quantity=1,entry_date=TODAY,evidence='Paid goods returned and physical refund authorized TEST-12')
    before=balance(live,'1000')
    with pytest.raises(HTTPException,match='explicit cash or bank refund'):
        call(live,'owner',lambda s,a:restore_return(s,a,ret))
    # Failed refund did not restore stock or leave a partial credit note.
    assert next(r for r in call(live,'viewer',lambda s,a:overview(s))['items'] if r['id']==item)['quantity']==2
    ret=ret.model_copy(update={'refund_method':'Cash'})
    result=call(live,'owner',lambda s,a:restore_return(s,a,ret))
    assert result['refund_amount']=='200.00' and result['gross_restored']=='33.33'
    assert balance(live,'1000')==before-D('200')
    assert call(live,'owner',lambda s,a:restore_return(s,a,ret))==result
    assert call(live,'viewer',lambda s,a:trial_balance(s,TODAY))['exceptions']==[]
    with psycopg.connect(URL) as c:
        version,cost=c.execute('SELECT version,cost_price FROM catalog_items WHERE id=%s',(item,)).fetchone()
    renamed=call(live,'owner',lambda s,a:catalog_mutate(s,a,CatalogMutation(request_key=uuid4(),operation='item.save',item_id=item,expected_version=version,details={'name':'Renamed valued widget','cost_price':str(cost)})))
    assert renamed['name']=='Renamed valued widget'
    with pytest.raises(HTTPException,match='adopted valuation workflow'):
        call(live,'owner',lambda s,a:catalog_mutate(s,a,CatalogMutation(request_key=uuid4(),operation='item.save',item_id=item,expected_version=renamed['version'],details={'cost_price':'999'})))



def test_supporting_schedules_and_current_portion_are_not_unchecked_text(live):
    data=draft()
    data.schedules=[{
      'gap':'ASSET-01','title':'External asset register','calculation_and_assumptions':'Reviewed useful lives, residual values, impairment and zero opening asset position.',
      'evidence':'Signed accountant register REF-ASSET-01',
      'rows':[{'label':'Foreign account must fail','account_id':str(uuid4()),'opening':'0.00','debits':'0.00','credits':'0.00','closing':'1.00'}]
    }]
    # Revalidate imports through the actual API model; raw dictionaries are not trusted.
    data=CloseDraft.model_validate(data.model_dump(mode='json'))
    data.maturities=[{'account_id':str(live.codes['2500']),'as_of':str(TODAY),'current_portion':'50000.00','rights_and_covenants':'Contract maturity and reporting-date covenant rights reviewed REF-MAT-01'}]
    data=CloseDraft.model_validate(data.model_dump(mode='json'))
    saved=call(live,'editor',lambda s,a:save_close(s,a,data))
    assert any(i['check']=='ASSET-01' and 'does not equal' in i['message'] for i in saved['issues'])
    assert any(i['check']=='ASSET-01' and 'not mapped' in i['message'] for i in saved['issues'])
    sections={s['key']:s for s in saved['statements']['financial_position']['sections']}
    assert sections['current_liabilities']['total'][0]=='200000.50'
    assert sections['non_current_liabilities']['total'][0]=='150000.00'
    assert saved['statements']['financial_position']['difference'][0]=='0.00'



def test_allowance_policy_preserves_an_existing_account_history(live):
    acc=call(live,'owner',lambda s,a:account_create(s,a,AccountCreate(request_key=uuid4(),kind='current_asset',name='Existing current asset')))
    for credited in (False,True):
        key=uuid4()
        cmd=PostingCommand(request_key=key,source_id=key,kind='adjustment',main_account_id=acc['id'],entry_date=TODAY,narration='Historical asset entry',credited=credited,lines=[{'account_id':live.codes['4900'],'amount':'1.00','credited':not credited}])
        call(live,'owner',lambda s,a:post_command(s,a,cmd))
    with pytest.raises(HTTPException,match='dedicated unused account'):
        call(live,'owner',lambda s,a:set_policy(s,a,InventoryPolicy(request_key=uuid4(),formula='moving_weighted_average',allowance_account_id=acc['id'],evidence='A zero balance does not erase previous accounting history')))
