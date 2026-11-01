"""Structured library reports with explicit, transaction-supported cash-flow corrections."""
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from fastapi import HTTPException
from python_accounting.reports import CashflowStatement

ZERO=Decimal('0')
PROFIT_TYPES={'OPERATING_REVENUE','NON_OPERATING_REVENUE','OPERATING_EXPENSE','DIRECT_EXPENSE','OVERHEAD_EXPENSE','OTHER_EXPENSE'}

def money(amount):
    # Adding zero turns a negated zero into 0.00, never -0.00.
    return format(Decimal(amount).quantize(Decimal('0.01')) + 0, '.2f')

def validate_dates(start: date, end: date):
    if start>end or (end-start).days>3660:
        raise HTTPException(422, 'Invalid reporting date range')

def ledger_rows(session, end):
    # A ledger leg is unique; joining on business_id prevents cross-tenant mappings.
    rows = list(session.connection().exec_driver_sql("""
      SELECT l.id,l.transaction_id,l.transaction_date,l.entry_type::text,l.amount,
             a.id account_id,a.name,a.account_type::text,m.account_id source_account_id,
             m.flow_section,m.purpose,f.flow_section folio_section,t.narration,t.transaction_no
      FROM accounting.ledger l JOIN accounting.account a ON a.id=l.post_account_id AND a.business_id=l.business_id
      JOIN accounting.account_map m ON m.library_id=a.id AND m.business_id=l.business_id
      JOIN accounting.account_map f ON f.library_id=l.folio_account_id AND f.business_id=l.business_id
      JOIN accounting."transaction" t ON t.id=l.transaction_id AND t.business_id=l.business_id
      WHERE l.business_id=%s AND l.transaction_date < %s ORDER BY l.transaction_date,l.id
    """, (str(session.business_id),datetime.combine(end+timedelta(days=1),time.min))).mappings())

    count=session.connection().exec_driver_sql('SELECT count(*) FROM accounting.ledger WHERE business_id=%s AND transaction_date<%s',
        (str(session.business_id),datetime.combine(end+timedelta(days=1),time.min))).scalar()
    if len(rows)!=count:raise HTTPException(409,'Every posted account requires a reviewed cash-flow mapping')
    return rows

def cash_flow(session,start:date,end:date):
    validate_dates(start,end)
    native=CashflowStatement(session,datetime.combine(start,time.min),datetime.combine(end,time.max))
    rows=ledger_rows(session,end)
    # Missing mappings must not silently drop ledger legs.
    actual=session.connection().exec_driver_sql('SELECT count(*) FROM accounting.ledger WHERE business_id=%s AND transaction_date<%s',
        (str(session.business_id),datetime.combine(end+timedelta(days=1),time.min))).scalar()
    if len(rows)!=actual:
        raise HTTPException(409,'Every posted account requires a reviewed cash-flow mapping')
    groups=defaultdict(lambda: {'amount':ZERO,'details':[]})
    opening=closing=ZERO
    # The approved opening position is dated on the start date but is the position brought in,
    # not activity: its cash is opening cash and its other legs are not flows of the period.
    brought_in=opening_transactions(session)
    for row in rows:
        signed=row['amount']*(1 if row['entry_type']=='DEBIT' else -1)
        before=row['transaction_date'].date()<start or row['transaction_id'] in brought_in
        if row['flow_section']=='cash':
            closing+=signed
            if before:opening+=signed
            continue
        if before:continue
        flow=-signed
        section=row['flow_section']
        if section=='restricted':section='investing'
        profit=row['account_type'] in PROFIT_TYPES
        label='Net profit' if profit else row['name']
        def add(section,label,value):
            key=(section,label)
            groups[key]['amount']+=value
            groups[key]['details'].append({'ledger_id':row['id'],'transaction_id':row['transaction_id'],
                'transaction_no':row['transaction_no'],'date':row['transaction_date'].date().isoformat(),
                'account_id':str(row['source_account_id']),'account_name':row['name'],
                'description':row['narration'],'amount':money(value)})
        if profit:
            add('operating','Net profit',flow)
            if section!='operating':add('operating','Profit classified outside operating activities',-flow)
        else:
            add(section,label,flow)
        if profit and section!='operating':add(section,row['name'],flow)
        if section in {'investing','financing'} and row['folio_section']!='cash':
            # Remove actual non-cash ledger legs, e.g. an asset bought on credit.
            # The matching operating leg is neutralized with a traceable adjustment.
            add(section,'Non-cash movements excluded',-flow)
            add('operating','Non-cash investing and financing adjustments',flow)
    native_profit=Decimal(native.balances['OPERATING_CASH_FLOW'].get('Net Profit',ZERO))
    if groups[('operating','Net profit')]['amount']!=native_profit:
        raise HTTPException(409,'Library net profit does not reconcile with the mapped posted ledger')
    # Use the library's structured profit result directly after reconciling its
    # supporting ledger details; subsequent rows are explicit policy corrections.
    groups[('operating','Net profit')]['amount']=native_profit
    # Settle capital purchases in the same section as their originating bill,
    # including partial settlements. A general payable account cannot encode this.
    allocations=session.connection().exec_driver_sql("""
      SELECT payment.id transaction_id,payment.transaction_no,payment.narration,
             payment.transaction_date,a.amount allocated,l.amount component,l.entry_type::text,
             m.flow_section,m.account_id,m.purpose,acc.name,
             (SELECT sum(li.amount*li.quantity) FROM accounting.line_item li
              WHERE li.transaction_id=bill.id AND li.business_id=bill.business_id) bill_amount
      FROM accounting.assignment a
      JOIN accounting."transaction" payment ON payment.id=a.transaction_id AND payment.business_id=a.business_id
      JOIN accounting."transaction" bill ON bill.id=a.assigned_id AND bill.business_id=a.business_id
      JOIN accounting.ledger l ON l.transaction_id=bill.id AND l.business_id=bill.business_id AND l.post_account_id<>bill.account_id
      JOIN accounting.account_map m ON m.library_id=l.post_account_id AND m.business_id=l.business_id
      JOIN accounting.account acc ON acc.id=l.post_account_id AND acc.business_id=l.business_id
      WHERE a.business_id=%s AND payment.transaction_type='SUPPLIER_PAYMENT'
       AND payment.transaction_date>=%s AND payment.transaction_date<%s
       AND m.flow_section IN ('investing','financing','restricted')
    """,(str(session.business_id),datetime.combine(start,time.min),datetime.combine(end+timedelta(days=1),time.min))).mappings()
    for allocation in allocations:
        if not allocation['bill_amount']:raise HTTPException(409,'Invalid allocated bill total')
        section=allocation['flow_section'] if allocation['flow_section']!='restricted' else 'investing'
        value=-allocation['allocated']*allocation['component']/allocation['bill_amount']
        detail={'ledger_id':0,'transaction_id':allocation['transaction_id'],'transaction_no':allocation['transaction_no'],
                'date':allocation['transaction_date'].date().isoformat(),'account_id':str(allocation['account_id']),
                'account_name':allocation['name'],'description':'Settlement allocation: '+allocation['narration'],'amount':money(value)}
        groups[(section,'Settlement of capital or financing obligations')]['amount']+=value
        groups[(section,'Settlement of capital or financing obligations')]['details'].append(detail)
        groups[('operating','Settlements classified outside operating activities')]['amount']-=value
        groups[('operating','Settlements classified outside operating activities')]['details'].append({**detail,'amount':money(-value)})
    sections=[]
    for section in ('operating','investing','financing'):
        lines=[{'label':label,'amount':money(v['amount']),'details':v['details']}
               for (key,label),v in groups.items() if key==section and v['amount']!=ZERO]
        total=sum((v['amount'] for (key,_),v in groups.items() if key==section),ZERO)
        sections.append({'key':section,'lines':lines,'total':money(total)})
    net=sum((Decimal(s['total']) for s in sections),ZERO)
    calculated=opening+net
    difference=calculated-closing
    return {'business_id':str(session.business_id),'method':'indirect','currency':'NGN',
            'timezone':session.business_timezone,'start_date':start.isoformat(),'end_date':end.isoformat(),
            'sections':sections,'net_change':money(net),'opening_cash':money(opening),
            'fx_effect':money(ZERO),'closing_cash':money(calculated),'ledger_cash':money(closing),
            'difference':money(difference),'reconciled':difference==ZERO,'empty':not any(not r['transaction_date'].date()<start and r['transaction_id'] not in brought_in for r in rows),
            'library_totals':{str(k):money(v) for k,v in native.totals.items()},
            'library_results':{str(k):money(v) for k,v in native.result_amounts.items()}}

def financial_summary(session,start:date,end:date):
    validate_dates(start,end)
    balances=defaultdict(lambda:ZERO);movements=defaultdict(lambda:ZERO);accounts={}
    rows=ledger_rows(session,end)
    for row in rows:
        key=str(row['source_account_id']);accounts[key]=row
        signed=row['amount']*(1 if row['entry_type']=='DEBIT' else -1)
        balances[key]+=signed
        if row['transaction_date'].date()>=start:movements[key]+=signed
    income=-sum((movements[k] for k,r in accounts.items() if r['account_type'].endswith('REVENUE')),ZERO)
    expense=sum((movements[k] for k,r in accounts.items() if r['account_type'].endswith('EXPENSE')),ZERO)
    cash=sum((balances[k] for k,r in accounts.items() if r['flow_section']=='cash'),ZERO)
    inventory=sum((balances[k] for k,r in accounts.items() if r['account_type']=='INVENTORY'),ZERO)
    receivables=sum((balances[k] for k,r in accounts.items() if r['account_type']=='RECEIVABLE'),ZERO)
    asset_types={'BANK','RECEIVABLE','INVENTORY','CURRENT_ASSET','NON_CURRENT_ASSET','CONTRA_ASSET'}
    liability_types={'PAYABLE','CONTROL','CURRENT_LIABILITY','NON_CURRENT_LIABILITY'}
    assets=sum((balances[k] for k,r in accounts.items() if r['account_type'] in asset_types),ZERO)
    liabilities=-sum((balances[k] for k,r in accounts.items() if r['account_type'] in liability_types),ZERO)
    capital=-sum((balances[k] for k,r in accounts.items() if r['account_type'] in {'EQUITY','RECONCILIATION'}),ZERO)
    retained=-sum((balances[k] for k,r in accounts.items() if r['account_type'] in PROFIT_TYPES),ZERO)
    trend=defaultdict(lambda:ZERO)
    for r in rows:
        if r['transaction_date'].date()>=start and r['account_type'].endswith('REVENUE'):
            trend[r['transaction_date'].date().isoformat()]+=r['amount']*(-1 if r['entry_type']=='DEBIT' else 1)
    return {'assets':{'cash':money(cash),'inventory':money(inventory),'receivables':money(receivables),'total':money(assets)},
            'liabilities':{'total':money(liabilities)},'equity':{'capital':money(capital),'retainedEarnings':money(retained),'total':money(capital+retained)},
            'balance_sheet_difference':money(assets-liabilities-capital-retained),
            'transaction_count':len({r['transaction_id'] for r in rows if r['transaction_date'].date()>=start}),
            'revenue_trend':[{'period':key,'income':money(value)} for key,value in sorted(trend.items())],
            'income':money(income),'expenses':money(expense),'net_profit':money(income-expense),
            'cash':money(cash),'inventory':money(inventory),'receivables':money(receivables),
            'trial_balance':[{'account_id':k,'name':r['name'],'type':r['account_type'],
                'debit':money(max(balances[k],ZERO)),'credit':money(max(-balances[k],ZERO))} for k,r in accounts.items()],
            'trial_balance_difference':money(sum(balances.values(),ZERO))}


def opening_transactions(session):
    """Transactions that carry the approved opening position: the opening journal and one entry per customer or supplier."""
    evidence=session.connection().exec_driver_sql('SELECT reconciliation_evidence FROM accounting.business_map WHERE business_id=%s',
        (str(session.business_id),)).scalar() or {}
    ids={evidence.get('transaction_id')}|{d.get('transaction_id') for d in evidence.get('opening_documents',[])}
    return {i for i in ids if i is not None}

LABELS={'tier':'Management statements, not reviewed','basis':'Accrual','currency':'NGN'}

def _generated(session):
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo(session.business_timezone)).isoformat(timespec='seconds')

def _outstanding(session,source_type):
    from python_accounting.models import Transaction
    rows=session.connection().exec_driver_sql('SELECT transaction_id FROM accounting.document_map WHERE business_id=%s AND source_type=%s',
        (str(session.business_id),source_type)).all()
    if len(rows)>5000:raise HTTPException(409,'Too many open documents to check in one report')
    total=ZERO
    for row in rows:
        document=session.get(Transaction,row.transaction_id)
        total+=document.amount-document.cleared(session)
    return total

def trial_balance(session,as_of:date):
    """FR-143: every account's balance at the end of as_of, with the ACC-013 control checks at the top."""
    rows=ledger_rows(session,as_of)
    balances=defaultdict(lambda:ZERO);accounts={}
    for row in rows:
        key=str(row['source_account_id']);accounts[key]=row
        balances[key]+=row['amount']*(1 if row['entry_type']=='DEBIT' else -1)
    # Code and name as the owner sees them in the chart; the ledger keeps its own title-cased copy of the name.
    chart={r.id:(r.code,r.name) for r in session.connection().exec_driver_sql('SELECT id::text AS id,code,name FROM public.accounts WHERE business_id=%s',(str(session.business_id),)).all()}
    codes={k:v[0] for k,v in chart.items()}
    lines=[{'account_id':k,'code':codes.get(k),'name':chart.get(k,(None,r['name']))[1],'type':r['account_type'],
            'debit':money(max(balances[k],ZERO)),'credit':money(max(-balances[k],ZERO))}
           for k,r in sorted(accounts.items(),key=lambda item:(codes.get(item[0]) or '',item[1]['name'])) if balances[k]!=ZERO]
    debits=sum((Decimal(l['debit']) for l in lines),ZERO);credits=sum((Decimal(l['credit']) for l in lines),ZERO)
    exceptions=[]
    if debits!=credits:exceptions.append({'check':'trial_balance','message':'Debits and credits differ','difference':money(debits-credits)})
    # Subledgers hold today's position, so the control checks run only for a report up to today.
    today=datetime.fromisoformat(_generated(session)).date()
    checked=as_of>=today
    if checked:
        def control(types):
            return sum((balances[k] for k,r in accounts.items() if r['account_type'] in types),ZERO)
        stock=session.connection().exec_driver_sql("""SELECT coalesce(sum(stock_quantity*coalesce(cost_price,0)),0) FROM public.catalog_items
            WHERE business_id=%s AND item_type='PRODUCT' AND track_stock AND is_active AND stock_quantity>0""",(str(session.business_id),)).scalar()
        for check,label,ledger,sub in (('receivables','Customer balances on open invoices',control({'RECEIVABLE'}),_outstanding(session,'invoice')),
                                       ('payables','Supplier balances on open bills',-control({'PAYABLE'}),_outstanding(session,'bill')),
                                       ('stock','Stock on hand at cost',control({'INVENTORY'}),Decimal(stock))):
            if ledger!=sub:exceptions.append({'check':check,'message':f'{label} ({money(sub)}) differ from the ledger ({money(ledger)})','difference':money(ledger-sub)})
    return {**LABELS,'as_of':as_of.isoformat(),'generated_at':_generated(session),'lines':lines,'total_debit':money(debits),
            'total_credit':money(credits),'difference':money(debits-credits),'controls_checked':checked,'exceptions':exceptions}

PAGE=100

def general_ledger(session,account_id,start:date,end:date,page:int=0):
    """FR-140: one account's entries for a period with opening, running and closing balances, 100 per page."""
    validate_dates(start,end)
    if page<0 or page>100000:raise HTTPException(422,'Invalid page')
    tenant=str(session.business_id)
    account=session.connection().exec_driver_sql("""SELECT a.code,a.name,m.library_id FROM accounting.account_map m
        JOIN public.accounts a ON a.id=m.account_id AND a.business_id=m.business_id WHERE m.business_id=%s AND m.account_id=%s""",
        (tenant,str(account_id))).first()
    if not account:raise HTTPException(404,'Account not found in this business')
    begin=datetime.combine(start,time.min);finish=datetime.combine(end+timedelta(days=1),time.min)
    signed="CASE WHEN l.entry_type::text='DEBIT' THEN l.amount ELSE -l.amount END"
    opening=session.connection().exec_driver_sql(f'SELECT coalesce(sum({signed}),0) FROM accounting.ledger l WHERE l.business_id=%s AND l.post_account_id=%s AND l.transaction_date<%s',
        (tenant,account.library_id,begin)).scalar()
    totals=session.connection().exec_driver_sql(f"""SELECT count(*),coalesce(sum(l.amount) FILTER (WHERE l.entry_type::text='DEBIT'),0),
        coalesce(sum(l.amount) FILTER (WHERE l.entry_type::text='CREDIT'),0) FROM accounting.ledger l
        WHERE l.business_id=%s AND l.post_account_id=%s AND l.transaction_date>=%s AND l.transaction_date<%s""",(tenant,account.library_id,begin,finish)).one()
    rows=session.connection().exec_driver_sql(f"""SELECT * FROM (
        SELECT l.id,l.transaction_date,t.transaction_no,t.narration,l.entry_type::text AS entry_type,l.amount,
          coalesce(fa.code||' '||fa.name,fn.name) AS counter_account,
          sum({signed}) OVER (ORDER BY l.transaction_date,l.id) AS running
        FROM accounting.ledger l JOIN accounting."transaction" t ON t.id=l.transaction_id AND t.business_id=l.business_id
        JOIN accounting.account fn ON fn.id=l.folio_account_id AND fn.business_id=l.business_id
        LEFT JOIN accounting.account_map fm ON fm.library_id=l.folio_account_id AND fm.business_id=l.business_id
        LEFT JOIN public.accounts fa ON fa.id=fm.account_id AND fa.business_id=fm.business_id
        WHERE l.business_id=%s AND l.post_account_id=%s AND l.transaction_date>=%s AND l.transaction_date<%s) e
        ORDER BY transaction_date,id LIMIT %s OFFSET %s""",(tenant,account.library_id,begin,finish,PAGE,page*PAGE)).all()
    entries=[{'date':r.transaction_date.date().isoformat(),'number':r.transaction_no,'description':r.narration,'counter_account':r.counter_account,
              'debit':money(r.amount if r.entry_type=='DEBIT' else ZERO),'credit':money(r.amount if r.entry_type=='CREDIT' else ZERO),
              'balance':money(opening+r.running)} for r in rows]
    return {**LABELS,'generated_at':_generated(session),'account':{'id':str(account_id),'code':account.code,'name':account.name},
            'start_date':start.isoformat(),'end_date':end.isoformat(),'opening_balance':money(opening),
            'total_debit':money(totals[1]),'total_credit':money(totals[2]),'closing_balance':money(opening+totals[1]-totals[2]),
            'entries':entries,'page':page,'page_size':PAGE,'total_entries':totals[0]}


def _year_before(day:date):
    try:return day.replace(year=day.year-1)
    except ValueError:return day.replace(year=day.year-1,day=28)  # 29 February

def comparison_period(start:date,end:date,compare):
    if compare=='prior':
        length=(end-start).days+1
        return start-timedelta(days=length),start-timedelta(days=1)
    if compare=='last_year':return _year_before(start),_year_before(end)
    if compare is None:return None
    raise HTTPException(422,'Compare with prior or last_year')

INCOME_SECTIONS=[('revenue','Revenue',{'OPERATING_REVENUE'},-1),('cost_of_sales','Cost of sales',{'DIRECT_EXPENSE'},1),
    ('operating_expenses','Operating expenses',{'OPERATING_EXPENSE','OVERHEAD_EXPENSE'},1),
    ('other_income','Other income',{'NON_OPERATING_REVENUE'},-1),('other_expenses','Other expenses',{'OTHER_EXPENSE'},1)]
POSITION_SECTIONS=[('current_assets','Current assets',{'BANK','RECEIVABLE','INVENTORY','CURRENT_ASSET'},1),
    ('non_current_assets','Non-current assets',{'NON_CURRENT_ASSET','CONTRA_ASSET'},1),
    ('current_liabilities','Current liabilities',{'PAYABLE','CURRENT_LIABILITY','CONTROL'},-1),
    ('non_current_liabilities','Non-current liabilities',{'NON_CURRENT_LIABILITY'},-1),
    ('equity','Equity',{'EQUITY','RECONCILIATION'},-1)]

def statements(session,start:date,end:date,compare=None):
    """FR-140 to FR-142: statement of profit or loss for the period and statement of financial position at its end,
    each with an optional comparison column (Doc 09: prior period or the same period last year)."""
    validate_dates(start,end)
    periods=[(start,end)]
    other=comparison_period(start,end,compare)
    if other:periods.append(other)
    rows=ledger_rows(session,end)
    chart={r.id:(r.code,r.name) for r in session.connection().exec_driver_sql('SELECT id::text AS id,code,name FROM public.accounts WHERE business_id=%s',(str(session.business_id),)).all()}
    types={};moves=[defaultdict(lambda:ZERO) for _ in periods];balances=[defaultdict(lambda:ZERO) for _ in periods]
    for row in rows:
        key=str(row['source_account_id']);types[key]=row['account_type']
        signed=row['amount']*(1 if row['entry_type']=='DEBIT' else -1);day=row['transaction_date'].date()
        for i,(s,e) in enumerate(periods):
            if day<=e:balances[i][key]+=signed
            if s<=day<=e:moves[i][key]+=signed
    def section(key,title,kinds,sign,values):
        accounts=sorted((k for k,t in types.items() if t in kinds and any(v[k] for v in values)),key=lambda k:(chart.get(k,('',''))[0] or '',k))
        lines=[{'account_id':k,'code':chart.get(k,(None,None))[0],'name':chart.get(k,(None,'Unknown account'))[1],
                'amounts':[money(sign*v[k]) for v in values]} for k in accounts]
        totals=[sign*sum((v[k] for k in accounts),ZERO) for v in values]
        return {'key':key,'title':title,'lines':lines,'total':[money(t) for t in totals]},totals
    income={};sums={}
    for key,title,kinds,sign in INCOME_SECTIONS:income[key],sums[key]=section(key,title,kinds,sign,moves)
    gross=[sums['revenue'][i]-sums['cost_of_sales'][i] for i in range(len(periods))]
    net=[gross[i]-sums['operating_expenses'][i]+sums['other_income'][i]-sums['other_expenses'][i] for i in range(len(periods))]
    position={};totals={}
    for key,title,kinds,sign in POSITION_SECTIONS:position[key],totals[key]=section(key,title,kinds,sign,balances)
    # Books are not closed at year end yet, so all profit to date is shown as its own line in equity.
    profit=[-sum((v[k] for k,t in types.items() if t in PROFIT_TYPES),ZERO) for v in balances]
    position['equity']['lines'].append({'account_id':None,'code':None,'name':'Profit to date not yet closed to retained earnings','amounts':[money(p) for p in profit]})
    equity=[totals['equity'][i]+profit[i] for i in range(len(periods))]
    position['equity']['total']=[money(e) for e in equity]
    assets=[totals['current_assets'][i]+totals['non_current_assets'][i] for i in range(len(periods))]
    liabilities=[totals['current_liabilities'][i]+totals['non_current_liabilities'][i] for i in range(len(periods))]
    exceptions=[]
    for i,(s,e) in enumerate(periods):
        label='this period' if i==0 else 'the comparison period'
        if sum(balances[i].values(),ZERO)!=ZERO:exceptions.append({'check':'trial_balance','message':f'Debits and credits differ at the end of {label}'})
        if assets[i]!=liabilities[i]+equity[i]:exceptions.append({'check':'financial_position','message':f'Assets do not equal liabilities and equity at the end of {label}'})
    return {**LABELS,'generated_at':_generated(session),'periods':[{'start_date':s.isoformat(),'end_date':e.isoformat()} for s,e in periods],
            'compare':compare,'exceptions':exceptions,
            'income_statement':{'sections':[income[k] for k,*_ in INCOME_SECTIONS],'gross_profit':[money(g) for g in gross],'net_profit':[money(n) for n in net]},
            'financial_position':{'sections':[position[k] for k,*_ in POSITION_SECTIONS],'total_assets':[money(a) for a in assets],
                'total_liabilities':[money(l) for l in liabilities],'total_equity':[money(e) for e in equity],
                'difference':[money(assets[i]-liabilities[i]-equity[i]) for i in range(len(periods))]}}
