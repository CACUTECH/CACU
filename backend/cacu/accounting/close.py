"""Versioned financial close with accountant evidence and ledger-reconciled external schedules.

This integrates professional schedules; it does not invent actuarial, tax, lease or valuation assumptions.
Saved submissions are immutable. An independent Owner/Admin records approval of an unchanged submission.
Every retrieval recomputes the ledger fingerprint; subsequent postings cannot retain a stale approval.
"""
from collections import defaultdict
from datetime import date
from decimal import Decimal
import hashlib
import json
from typing import Literal
from uuid import UUID
from fastapi import HTTPException
from pydantic import BaseModel,ConfigDict,Field
from cacu.accounting.posting import raw
from cacu.accounting.workflows import role,durable
from cacu.accounting.reports import ledger_rows,statements,cash_flow,money,PROFIT_TYPES,ZERO,opening_transactions,validate_dates

GAPS={
 'IAS2-01':'Cost formula, eligible landed costs, returns and item valuation history',
 'IAS2-02':'NRV, selling/completion costs, write-downs, reversals and disclosures',
 'IAS2-03':'Goods receipts, supplier matching, rebates and tax recoverability',
 'IAS7-01':'Gross receipt/payment classes; documented netting exceptions if any',
 'IAS7-02':'Interest, dividends and income taxes: cash settlement timing and policy',
 'IAS7-03':'Cash-equivalent eligibility, restrictions and integral overdrafts',
 'IAS7-04':'Cash components, financing liability changes and supplier finance arrangements',
 'PRES-01':'Complete statements, OCI, equity changes, annual comparatives, material notes, going concern',
 'PRES-02':'Loan maturity, rights at reporting date, covenant facts and current portions',
 'REV-01':'Completed obligations, control transfer, service progress, deposits and returns',
 'FIN-01':'ECL assumptions, ageing, effective interest, instrument measurement and risks',
 'ASSET-01':'Asset registers, components, useful lives, depreciation, amortisation, impairment and disposals',
 'LEASE-01':'Lease scope/exemptions, discount rates, ROU assets, liabilities and lease notes',
 'TAX-01':'Current and deferred income tax, rates, temporary differences and tax reconciliation',
 'PEOPLE-01':'Payroll, unpaid benefits, employer contributions and plan-specific obligations',
 'FX-01':'Functional currency; unsupported foreign transactions are excluded from NGN-only workflows',
 'NOTES-01':'Policies, estimates, errors/restatements, subsequent events, related parties, provisions/contingencies',
 'FUTURE-01':'IFRS 18 adoption date, opening transition, comparative restatement and classification decisions',
}
SIGNED=r'^-?[0-9]{1,13}(\.[0-9]{1,2})?$'
SCHEDULES={'FIN-01','ASSET-01','LEASE-01','TAX-01','PEOPLE-01'}

class Model(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)

class Note(Model):
    applicable:bool
    assessment:str=Field(min_length=10,max_length=4000)
    evidence:str=Field(min_length=10,max_length=2000)

class ScheduleRow(Model):
    label:str=Field(min_length=1,max_length=150)
    account_id:UUID
    opening:str=Field(pattern=SIGNED)
    debits:str=Field(pattern=SIGNED)
    credits:str=Field(pattern=SIGNED)
    closing:str=Field(pattern=SIGNED)

class Schedule(Model):
    gap:Literal['FIN-01','ASSET-01','LEASE-01','TAX-01','PEOPLE-01']
    title:str=Field(min_length=3,max_length=200)
    calculation_and_assumptions:str=Field(min_length=20,max_length=6000)
    evidence:str=Field(min_length=10,max_length=2000)
    rows:list[ScheduleRow]=Field(min_length=1,max_length=200)

class Maturity(Model):
    account_id:UUID
    as_of:date
    current_portion:str=Field(pattern=r'^[0-9]{1,13}(\.[0-9]{1,2})?$')
    rights_and_covenants:str=Field(min_length=10,max_length=2000)

class EquityClassification(Model):
    ledger_id:int=Field(gt=0)
    nature:Literal['owner_contribution','distribution','oci','transfer','prior_period_adjustment','other']
    evidence:str=Field(min_length=10,max_length=2000)

class CloseDraft(Model):
    request_key:UUID
    start_date:date
    end_date:date
    annual:bool=True
    compare:Literal['last_year','prior']='last_year'
    framework:Literal['full_ifrs']='full_ifrs'
    early_ifrs18:bool=False
    accountant_name:str=Field(min_length=3,max_length=200)
    accountant_review_evidence:str=Field(min_length=10,max_length=2000)
    notes:dict[str,Note]
    schedules:list[Schedule]=Field(default_factory=list,max_length=20)
    maturities:list[Maturity]=Field(default_factory=list,max_length=200)
    equity_classifications:list[EquityClassification]=Field(default_factory=list,max_length=500)

class Approval(Model):
    evidence:str=Field(min_length=10,max_length=2000)


def encoded(value):
    def serial(v):
        if isinstance(v,(date,UUID)):return str(v)
        if isinstance(v,Decimal):return str(v)
        raise TypeError('Unsupported snapshot value')
    return json.dumps(value,sort_keys=True,separators=(',',':'),default=serial)


def fingerprint(session,end):
    policies=raw(session,'SELECT account_id,effective_from,nature,section,cash_eligible,restricted,evidence,approved_by FROM accounting.cash_flow_classification WHERE business_id=%s AND effective_from<=%s ORDER BY account_id,effective_from',(str(session.business_id),end)).mappings().all()
    inventory=raw(session,'SELECT id,item_id,kind,entry_date,quantity,gross_change,allowance_change,evidence FROM accounting.inventory_value_event WHERE business_id=%s AND entry_date<=%s ORDER BY id',(str(session.business_id),end)).mappings().all()
    # Names/types/mappings also affect presentation; ledger_rows includes them.
    basis=raw(session,'SELECT cutover_date,timezone,reconciliation_evidence FROM accounting.business_map WHERE business_id=%s',(str(session.business_id),)).mappings().first()
    chart=raw(session,"SELECT a.id::text,a.name,to_jsonb(a)->>'code' AS code,a.is_active,n.account_type::text,m.flow_section,m.purpose FROM public.accounts a JOIN accounting.account_map m ON m.account_id=a.id AND m.business_id=a.business_id JOIN accounting.account n ON n.id=m.library_id AND n.business_id=m.business_id WHERE a.business_id=%s ORDER BY a.id",(str(session.business_id),)).mappings().all()
    return hashlib.sha256(encoded({'basis':dict(basis),'chart':[dict(r) for r in chart],'ledger':[dict(r) for r in ledger_rows(session,end)],'cash_policy':[dict(r) for r in policies],'inventory':[dict(r) for r in inventory]}).encode()).hexdigest()


def close_assessment(session,data:CloseDraft):
    if set(data.notes)!=set(GAPS):raise HTTPException(422,'Provide an applicability assessment, note and evidence for every gap-register item')
    issues=[]
    def issue(check,message):issues.append({'check':check,'message':message})
    for required in ('PRES-01','IAS7-01','IAS7-04','FX-01','NOTES-01'):
        if not data.notes[required].applicable:issue(required,'Statement presentation, cash policy, functional currency and close disclosures require an applicable review')
    cutover=raw(session,'SELECT cutover_date FROM accounting.business_map WHERE business_id=%s',(str(session.business_id),)).scalar()
    if data.start_date<cutover:issue('PRES-01','This period begins before the reconciled books start date; integrate reviewed pre-cutover statements before approval')
    if data.annual and data.compare!='last_year':issue('comparatives','Annual statements require the corresponding preceding-year comparison')
    if data.annual and not 364<=(data.end_date-data.start_date).days<=365:
        issue('annual_period','Use a full annual period; a short first period requires a separately reviewed reporting package')
    adoption=data.start_date>=date(2027,1,1) or data.early_ifrs18
    if adoption:issue('FUTURE-01','IFRS 18 presentation/transition is not certified by this release; complete reviewed transition statements before approval')
    report=statements(session,data.start_date,data.end_date,data.compare)
    cash=cash_flow(session,data.start_date,data.end_date)
    previous=report['periods'][1]
    prior_start=date.fromisoformat(previous['start_date']);prior_end=date.fromisoformat(previous['end_date'])
    prior_cash=None
    if prior_start>=cutover:
        prior_cash=cash_flow(session,prior_start,prior_end)
        if not prior_cash['reconciled']:issue('IAS7-04','Comparative cash flow does not reconcile')
    else:
        issue('PRES-01','Comparative ledger coverage is incomplete; a separately reviewed comparative package must be integrated before approval')
    issues.extend(report['exceptions'])
    if not cash['reconciled']:issue('IAS7-04','Cash flow does not reconcile')
    rows=ledger_rows(session,data.end_date);brought=opening_transactions(session)
    mapped=raw(session,'SELECT m.account_id::text AS id,a.name,n.account_type::text AS type FROM accounting.account_map m JOIN accounting.account n ON n.id=m.library_id AND n.business_id=m.business_id JOIN public.accounts a ON a.id=m.account_id AND a.business_id=m.business_id WHERE m.business_id=%s',(str(session.business_id),)).mappings().all()
    types={r['id']:r['type'] for r in mapped}
    names={r['id']:r['name'] for r in mapped}
    periods=report['periods'];equity_reports=[];oci_totals=[]
    comparisons=defaultdict(list)
    for index,period in enumerate(periods):
        start=date.fromisoformat(period['start_date']);end=date.fromisoformat(period['end_date'])
        opening=defaultdict(lambda:ZERO);closing=defaultdict(lambda:ZERO);debits=defaultdict(lambda:ZERO);credits=defaultdict(lambda:ZERO)
        for r in rows:
            key=str(r['source_account_id']);signed=r['amount']*(1 if r['entry_type']=='DEBIT' else -1);day=r['transaction_date'].date()
            if day<=end:closing[key]+=signed
            before=day<start or (r['transaction_id'] in brought and day<=end)
            if before:opening[key]+=signed
            elif day<=end:
                (debits if r['entry_type']=='DEBIT' else credits)[key]+=r['amount']
        if index==0:
            grouped=defaultdict(lambda:{'opening':ZERO,'debits':ZERO,'credits':ZERO,'closing':ZERO})
            for schedule in data.schedules:
                for r in schedule.rows:
                    if min(Decimal(r.debits),Decimal(r.credits))<0:issue(schedule.gap,'Schedule debit and credit movements must be nonnegative')
                    if Decimal(r.opening)+Decimal(r.debits)-Decimal(r.credits)!=Decimal(r.closing):issue(schedule.gap,f'{r.label}: opening plus debits less credits does not equal closing')
                    key=(schedule.gap,str(r.account_id))
                    for f in ('opening','debits','credits','closing'):grouped[key][f]+=Decimal(getattr(r,f))
            for (gap,key),values in grouped.items():
                if key not in types:issue(gap,'Schedule account is not mapped in this business')
                elif values!={'opening':opening[key],'debits':debits[key],'credits':credits[key],'closing':closing[key]}:
                    issue(gap,f'Schedule for {names[key]} does not reconcile to opening, gross movements and closing ledger balances')
            for gap in SCHEDULES:
                if data.notes[gap].applicable and gap not in {s.gap for s in data.schedules}:issue(gap,'A measured, accountant-reviewed schedule with ledger ties is required')
            schedule_types={gap:{types.get(str(r.account_id)) for s in data.schedules if s.gap==gap for r in s.rows} for gap in SCHEDULES}
            requirements={'FIN-01':({'RECEIVABLE','CURRENT_LIABILITY','NON_CURRENT_LIABILITY'},{'CURRENT_ASSET','CONTRA_ASSET','OTHER_EXPENSE','OPERATING_EXPENSE'}),'ASSET-01':({'NON_CURRENT_ASSET'},{'CONTRA_ASSET','NON_CURRENT_ASSET'}),
                'LEASE-01':({'NON_CURRENT_ASSET'},{'CURRENT_LIABILITY','NON_CURRENT_LIABILITY'}),
                'TAX-01':({'OTHER_EXPENSE','OPERATING_EXPENSE'},{'CURRENT_LIABILITY','NON_CURRENT_LIABILITY','CURRENT_ASSET','NON_CURRENT_ASSET'}),
                'PEOPLE-01':({'OPERATING_EXPENSE','OVERHEAD_EXPENSE'},{'CURRENT_LIABILITY','NON_CURRENT_LIABILITY'})}
            for gap,groups in requirements.items():
                if data.notes[gap].applicable and any(not (schedule_types[gap]&group) for group in groups):issue(gap,'Provide the related asset/expense and allowance/liability account schedules, including gross and accumulated amounts')
        # Require a dated contractual maturity assessment for every non-current liability balance.
        maturities={(str(m.account_id),m.as_of):m for m in data.maturities}
        if len(maturities)!=len(data.maturities):issue('PRES-02','Duplicate maturity assessments for the same account and date')
        current_section=next(s for s in report['financial_position']['sections'] if s['key']=='current_liabilities')
        noncurrent=next(s for s in report['financial_position']['sections'] if s['key']=='non_current_liabilities')
        for key,kind in types.items():
            if kind!='NON_CURRENT_LIABILITY' or not closing[key]:continue
            maturity=maturities.get((key,end))
            if not maturity:
                issue('PRES-02',f'{names[key]}: reporting-date rights, covenants and current portion require review for {end}')
                continue
            value=Decimal(maturity.current_portion)
            if value>max(ZERO,-closing[key]):issue('PRES-02','Current portion exceeds the outstanding liability');continue
            if value:
                line={'account_id':key,'code':None,'name':'Current portion: '+names[key],'amounts':['0.00']*len(periods)}
                line['amounts'][index]=money(value);current_section['lines'].append(line)
                current_section['total'][index]=money(Decimal(current_section['total'][index])+value)
                noncurrent['total'][index]=money(Decimal(noncurrent['total'][index])-value)
                for entry in noncurrent['lines']:
                    if entry['account_id']==key:entry['amounts'][index]=money(Decimal(entry['amounts'][index])-value)
        classified={c.ledger_id:c for c in data.equity_classifications}
        if len(classified)!=len(data.equity_classifications):issue('PRES-01','Duplicate equity movement classification')
        equity_keys={k for k,t in types.items() if t in {'EQUITY','RECONCILIATION'}}
        movements=defaultdict(lambda:ZERO);oci=ZERO
        for r in rows:
            day=r['transaction_date'].date();key=str(r['source_account_id'])
            if key not in equity_keys or not start<=day<=end or r['transaction_id'] in brought:continue
            c=classified.get(r['id'])
            if not c:issue('PRES-01',f'Classify equity ledger entry {r["id"]} for {end}');continue
            amount=r['amount']*(1 if r['entry_type']=='CREDIT' else -1)
            movements[c.nature]+=amount
            if c.nature=='oci':oci+=amount
        opening_equity=-sum((opening[k] for k,t in types.items() if t in {'EQUITY','RECONCILIATION'}|PROFIT_TYPES),ZERO)
        closing_equity=-sum((closing[k] for k,t in types.items() if t in {'EQUITY','RECONCILIATION'}|PROFIT_TYPES),ZERO)
        profit=-sum((debits[k]-credits[k] for k,t in types.items() if t in PROFIT_TYPES),ZERO)
        diff=opening_equity+profit+sum(movements.values(),ZERO)-closing_equity
        if diff:issue('PRES-01','Equity changes do not reconcile')
        equity_reports.append({'period':period,'opening_equity':money(opening_equity),'profit':money(profit),'movements':{k:money(v) for k,v in movements.items()},'closing_equity':money(closing_equity),'difference':money(diff),
            'accounts':[{'account_id':k,'name':names[k],'opening':money(-opening[k]),'movement':money(opening[k]-closing[k]),'closing':money(-closing[k])} for k in sorted(equity_keys)]})
        oci_totals.append(money(oci))
        for k in types:comparisons[k].append(money(closing[k]))
    # Scope declarations cannot contradict posted activity or held stock.
    if any(types[k]=='INVENTORY' and any(Decimal(v) for v in values) for k,values in comparisons.items()):
        if any(not data.notes[g].applicable for g in ('IAS2-01','IAS2-02','IAS2-03')):issue('IAS2-01','Inventory balances require inventory policy/NRV/receipt review')
    if any(types[k] in {'RECEIVABLE','NON_CURRENT_LIABILITY'} and any(Decimal(v) for v in values) for k,values in comparisons.items()) and not data.notes['FIN-01'].applicable:
        issue('FIN-01','Receivables or borrowings require financial-instrument applicability review')
    if data.notes['IAS2-01'].applicable:
        stock=raw(session,"""SELECT c.id,c.stock_quantity,c.cost_price,v.quantity,v.gross_cost,v.allowance FROM public.catalog_items c
          LEFT JOIN accounting.inventory_valuation v ON v.business_id=c.business_id AND v.item_id=c.id
          WHERE c.business_id=%s AND c.item_type='PRODUCT' AND c.track_stock AND c.is_active""",(str(session.business_id),)).all()
        if any(r.quantity is None or r.quantity!=r.stock_quantity for r in stock):issue('IAS2-01','Adopt and reconcile all tracked items before close approval')
        # Historical close uses immutable events, not today's on-hand stock.
        totals=raw(session,'SELECT coalesce(sum(gross_change),0),coalesce(sum(allowance_change),0) FROM accounting.inventory_value_event WHERE business_id=%s AND entry_date<=%s',(str(session.business_id),data.end_date)).one()
        ledger=sum((Decimal(values[0]) for k,values in comparisons.items() if types[k]=='INVENTORY'),ZERO)
        if totals[0]!=ledger:issue('IAS2-01','Item gross valuation does not reconcile to the inventory ledger')
        p=raw(session,'SELECT allowance_account_id FROM accounting.inventory_policy WHERE business_id=%s',(str(session.business_id),)).scalar()
        if not p or -Decimal(comparisons.get(str(p),['0.00'])[0])!=totals[1]:issue('IAS2-02','NRV allowance does not reconcile to its ledger control')
    # Explicit period-versioned transition plan, never a silent switch based on report issue date.
    return {'tier':'Management statements, not reviewed','issues':issues,'ready_for_owner_approval':not issues,
        'statement_basis':'IFRS 18 transition required' if adoption else 'IAS 1 / pre-IFRS 18 IAS 7',
        'statements':report,'cash_flow':cash,'comparative_cash_flow':prior_cash,'changes_in_equity':equity_reports,
        'comprehensive_income':{'net_profit':report['income_statement']['net_profit'],'other_comprehensive_income':oci_totals,
            'total_comprehensive_income':[money(Decimal(n)+Decimal(o)) for n,o in zip(report['income_statement']['net_profit'],oci_totals)]},
        'notes':{k:v.model_dump() for k,v in data.notes.items()},'schedules':[s.model_dump(mode='json') for s in data.schedules],
        'transition':{'mandatory_period_start':'2027-01-01','early_adoption':data.early_ifrs18,'required':['Reviewed IFRS 18 profit categories and subtotals','Operating-profit cash-flow starting point','Updated interest/dividend policy and entity exceptions','Retrospective transition comparatives and reconciliation']}}


def save_close(session,actor,data:CloseDraft):
    validate_dates(data.start_date,data.end_date)
    if set(data.notes)!=set(GAPS):raise HTTPException(422,'Provide review evidence for every gap-register item')
    def execute():
        if role(session,actor) not in {'owner','admin','editor'}:raise HTTPException(403,'Business write permission required')
        payload=data.model_dump(mode='json');digest=hashlib.sha256(encoded(payload).encode()).hexdigest()
        raw(session,'INSERT INTO accounting.reporting_close(business_id,id,start_date,end_date,payload,ledger_hash,payload_hash,created_by) VALUES(%s,%s,%s,%s,%s::jsonb,%s,%s,%s)',
            (str(session.business_id),str(data.request_key),data.start_date,data.end_date,json.dumps(payload),fingerprint(session,data.end_date),digest,str(actor)))
        return {'id':str(data.request_key)}
    saved=durable(session,actor,'reporting_close',data,execute)
    return load_close(session,UUID(saved['id']))


def load_close(session,close_id):
    row=raw(session,'SELECT * FROM accounting.reporting_close WHERE business_id=%s AND id=%s',(str(session.business_id),str(close_id))).first()
    if not row:raise HTTPException(404,'Reporting close not found')
    assessment=close_assessment(session,CloseDraft.model_validate(row.payload))
    unchanged=fingerprint(session,row.end_date)==row.ledger_hash
    approval=raw(session,'SELECT approved_by,approved_at,evidence FROM accounting.reporting_close_decision WHERE business_id=%s AND close_id=%s',(str(session.business_id),str(close_id))).first()
    if not unchanged:assessment['issues'].append({'check':'stale_review','message':'Ledger or valuation/classification evidence changed; submit and review a new version'})
    valid=bool(approval and unchanged and not assessment['issues'])
    return {'id':str(close_id),'created_by':str(row.created_by),'created_at':row.created_at.isoformat(),**assessment,
        'ready_for_owner_approval':unchanged and not assessment['issues'],'review_status':'approved' if valid else 'review_required',
        'approval':{'approved_by':str(approval.approved_by),'approved_at':approval.approved_at.isoformat(),'evidence':approval.evidence} if approval else None,
        'accountant_name':row.payload['accountant_name'],'accountant_review_evidence':row.payload['accountant_review_evidence'],
        'compliance_claim':'No automatic IFRS compliance certification'}


def approve_close(session,actor,close_id,data:Approval):
    if role(session,actor) not in {'owner','admin'}:raise HTTPException(403,'Owner or Admin approval required')
    result=load_close(session,close_id)
    if str(actor)==result['created_by']:raise HTTPException(403,'An independent Owner or Admin must approve the close')
    if not result['ready_for_owner_approval']:raise HTTPException(409,'Resolve all reconciliation, scope and review issues before approval')
    old=raw(session,'SELECT approved_by,evidence FROM accounting.reporting_close_decision WHERE business_id=%s AND close_id=%s',(str(session.business_id),str(close_id))).first()
    if old:
        if str(old.approved_by)!=str(actor) or old.evidence!=data.evidence:raise HTTPException(409,'This close already has an immutable approval')
        return result
    raw(session,'INSERT INTO accounting.reporting_close_decision(business_id,close_id,approved_by,evidence) VALUES(%s,%s,%s,%s)',(str(session.business_id),str(close_id),str(actor),data.evidence))
    raw(session,'INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,%s,%s::jsonb)',(str(session.business_id),str(actor),str(close_id),'reporting_close_approved',json.dumps({'close_id':str(close_id),'evidence':data.evidence})))
    return load_close(session,close_id)


def list_closes(session):
    rows=raw(session,'SELECT id,start_date,end_date,created_by,created_at FROM accounting.reporting_close WHERE business_id=%s ORDER BY created_at DESC LIMIT 50',(str(session.business_id),)).mappings()
    return [{k:str(v) for k,v in r.items()} for r in rows]
