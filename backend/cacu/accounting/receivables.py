"""Receivables (Doc 10 E11, Doc 09 ACC-006, PR-10, PR-11; Doc 11 R2: multi-invoice receipts, ageing, statements).

* One payment from a customer is split across their open invoices; each part clears its invoice and never exceeds what
  is still owed on it (less transfers already waiting). Whatever is paid beyond the split is kept as the customer's
  advance in Customer deposits and advances (PR-10), which can later be applied to one of their invoices (PR-11) or
  handed back.
* A transfer waits in Transfers awaiting confirmation as one transfer (BR-010); its parts count as waiting on each
  invoice. Confirming posts every part into the chosen bank; a part an invoice no longer needs becomes advance.
* Ageing lists what customers owe (or what is owed to suppliers) at a date by how long it is past due; a customer
  statement lists invoices, payments and advances with a running balance.
"""
from datetime import date
import json
from decimal import Decimal
from typing import Literal
from uuid import UUID,NAMESPACE_URL,uuid5
from fastapi import HTTPException
from pydantic import BaseModel,ConfigDict,Field
from python_accounting.models import Transaction
from cacu.accounting.posting import PostingCommand,post_command,raw
from cacu.accounting.workflows import (business_today,collection_account,durable,invoice_outstanding,party_account,
                                       receipt_posting,role)

MONEY=r'^[0-9]{1,13}(\.[0-9]{1,2})?$'
ZERO=Decimal('0')
BUCKETS=[('current','Not yet due'),('d1_30','1 to 30 days'),('d31_60','31 to 60 days'),('d61_90','61 to 90 days'),('over_90','Over 90 days')]


class Allocation(BaseModel):
    model_config=ConfigDict(extra='forbid')
    invoice_id:UUID
    amount:str=Field(pattern=MONEY)


class CustomerReceipt(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_key:UUID
    customer_id:UUID
    amount:str=Field(pattern=MONEY)
    entry_date:date
    method:Literal['Cash','Transfer']
    bank_account_id:UUID|None=None
    allocations:list[Allocation]=Field(default_factory=list,max_length=100)


class AdvanceApply(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_key:UUID
    amount:str=Field(pattern=MONEY)


class AdvanceRefund(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_key:UUID
    amount:str=Field(pattern=MONEY)
    method:Literal['Cash','Transfer']
    bank_account_id:UUID|None=None
    note:str=Field(min_length=3,max_length=500)


def _money(value):
    return format(Decimal(value),'.2f')


def _naira(value):
    return f'₦{Decimal(value):,.2f}'


def _customer(session,customer_id):
    row=raw(session,'SELECT id,name FROM public.customers WHERE business_id=%s AND id=%s',(str(session.business_id),str(customer_id))).first()
    if not row:raise HTTPException(404,'Customer not found')
    return row


def advance_balance(session,customer_id,as_of=None):
    """What a customer holds in advance: received less applied and refunded (up to a date when given)."""
    return Decimal(raw(session,"""SELECT coalesce(sum(CASE WHEN kind='received' THEN amount ELSE -amount END),0) FROM accounting.customer_advance
      WHERE business_id=%s AND customer_id=%s AND (%s::date IS NULL OR entry_date<=%s::date)""",
      (str(session.business_id),str(customer_id),as_of,as_of)).scalar())


def advances_account(session,actor,create):
    """Customer deposits and advances. The first advance adds it to the chart, which only an Owner or Admin can do."""
    from cacu.accounting.bookings import DEPOSITS_NAME,deposits_account
    found=deposits_account(session)
    if found is not None:return found
    if not create or role(session,actor) not in {'owner','admin'}:
        raise HTTPException(409,'Keeping money paid beyond the invoices needs Customer deposits and advances in your chart. '
                                'An Owner or Admin adds it by recording the first payment with an advance.')
    from cacu.accounting.accounts import add_account
    add_account(session,actor,uuid5(NAMESPACE_URL,f'cacu:customer-deposits:{session.business_id}'),'customer_deposits',DEPOSITS_NAME)
    return deposits_account(session)


def _waiting(session,invoice_ids):
    """Transfers waiting for confirmation on each invoice: single-invoice receipts and parts of customer payments."""
    if not invoice_ids:return {}
    tenant=str(session.business_id);ids=[str(i) for i in invoice_ids]
    rows=raw(session,"""SELECT invoice_id::text AS id,sum(amount) AS amount FROM accounting.pending_transfer
        WHERE business_id=%s AND status='pending' AND source_type='receipt' AND invoice_id::text = ANY(%s) GROUP BY 1
      UNION ALL
      SELECT a->>'invoice_id',sum((a->>'amount')::numeric) FROM accounting.customer_receipt r,jsonb_array_elements(r.allocations) a
        WHERE r.business_id=%s AND r.status='awaiting_transfer' AND a->>'invoice_id' = ANY(%s) GROUP BY 1""",(tenant,ids,tenant,ids)).all()
    result={}
    for r in rows:result[r.id]=result.get(r.id,ZERO)+Decimal(r.amount)
    return result


def open_items(session,customer_id):
    """A customer's issued invoices with something still owed, oldest due first, and the advance they hold."""
    customer=_customer(session,customer_id);tenant=str(session.business_id)
    rows=raw(session,"""SELECT i.id,i.invoice_number,i.issue_date,i.due_date,d.transaction_id FROM public.invoices i
      JOIN accounting.document_map d ON d.business_id=i.business_id AND d.source_type='invoice' AND d.source_id=i.id
      WHERE i.business_id=%s AND i.customer_id=%s ORDER BY coalesce(i.due_date,i.issue_date),i.issue_date,i.invoice_number LIMIT 500""",
      (tenant,str(customer_id))).all()
    waiting=_waiting(session,[r.id for r in rows]);invoices=[]
    for r in rows:
        tx=session.get(Transaction,r.transaction_id);outstanding=tx.amount-tx.cleared(session)
        if outstanding<=0:continue
        held=waiting.get(str(r.id),ZERO)
        invoices.append({'id':str(r.id),'invoice_number':r.invoice_number,'issue_date':r.issue_date.isoformat() if r.issue_date else None,
            'due_date':r.due_date.isoformat() if r.due_date else None,'total':_money(tx.amount),'outstanding':_money(outstanding),
            'waiting':_money(held),'open':_money(max(outstanding-held,ZERO))})
    return {'customer':{'id':str(customer.id),'name':customer.name},'invoices':invoices,
            'open_total':_money(sum((Decimal(i['open']) for i in invoices),ZERO)),'advance':_money(advance_balance(session,customer_id))}


def _post_parts(session,actor,receipt_id,parts,advance,collection,method,day):
    """Posts each invoice's part of a payment into the till or bank, and any advance into Customer deposits."""
    postings=[]
    for invoice_id,part in parts:
        result=receipt_posting(session,actor,uuid5(receipt_id,'invoice:'+str(invoice_id)),invoice_id,_money(part),method,collection,day)
        postings.append({'invoice_id':str(invoice_id),'amount':_money(part),'transaction_no':result.get('transaction_no')})
    advance_posting=None
    if advance>0:
        key=uuid5(receipt_id,'advance')
        advance_posting=post_command(session,actor,PostingCommand(request_key=key,kind='customer_advance',source_id=key,main_account_id=collection,
            entry_date=day,credited=False,narration='Advance from customer',
            lines=[{'account_id':advances_account(session,actor,True),'amount':_money(advance),'credited':True}]),internal=True)
    return postings,advance_posting


def _record_advance(session,actor,customer_id,receipt_id,advance,day,posting):
    raw(session,"""INSERT INTO accounting.customer_advance(business_id,id,customer_id,kind,amount,entry_date,receipt_id,posting,created_by)
      VALUES(%s,%s,%s,'received',%s,%s,%s,%s::jsonb,%s)""",(str(session.business_id),str(uuid5(receipt_id,'advance')),str(customer_id),advance,day,
      str(receipt_id),json.dumps(posting),str(actor)))


def receipt_create(session,actor,data:CustomerReceipt):
    def execute():
        tenant=str(session.business_id);customer=_customer(session,data.customer_id)
        amount=Decimal(data.amount)
        if amount<=0:raise HTTPException(422,'Enter an amount above zero')
        if data.entry_date>business_today(session):raise HTTPException(422,'A payment cannot be dated in the future')
        if len({a.invoice_id for a in data.allocations})!=len(data.allocations):raise HTTPException(422,'Each invoice appears once')
        parts=[];allocated=ZERO
        for a in sorted(data.allocations,key=lambda x:str(x.invoice_id)):
            part=Decimal(a.amount)
            if part<=0:raise HTTPException(422,'Each invoice part must be above zero')
            invoice=raw(session,'SELECT customer_id,invoice_number FROM public.invoices WHERE business_id=%s AND id=%s',(tenant,str(a.invoice_id))).first()
            if not invoice or str(invoice.customer_id)!=str(customer.id):raise HTTPException(422,'Each invoice must belong to this customer')
            outstanding,waiting=invoice_outstanding(session,a.invoice_id)
            if part>outstanding-waiting:
                raise HTTPException(409,f'{invoice.invoice_number}: {_naira(part)} is more than is still owed ({_naira(max(outstanding-waiting,ZERO))}, '
                                        'less transfers waiting for confirmation)')
            parts.append((a.invoice_id,part));allocated+=part
        advance=amount-allocated
        if advance<0:raise HTTPException(422,'The invoice parts add up to more than the payment')
        if advance>0:advances_account(session,actor,True)
        allocations=[{'invoice_id':str(i),'amount':_money(p)} for i,p in parts]
        base={'id':str(data.request_key),'customer_id':str(customer.id),'amount':_money(amount),'allocated':_money(allocated),'advance':_money(advance)}
        if data.method=='Transfer':
            # BR-010: held as one transfer until the money is confirmed; the invoices stay outstanding meanwhile.
            if data.bank_account_id is not None:collection_account(session,'Transfer',data.bank_account_id)
            raw(session,"""INSERT INTO accounting.customer_receipt(business_id,id,customer_id,amount,method,bank_account_id,entry_date,allocations,advance,status,created_by)
              VALUES(%s,%s,%s,%s,'transfer',NULL,%s,%s::jsonb,%s,'awaiting_transfer',%s)""",(tenant,str(data.request_key),str(customer.id),amount,
              data.entry_date,json.dumps(allocations),advance,str(actor)))
            raw(session,"""INSERT INTO accounting.pending_transfer(business_id,id,source_type,amount,entry_date,customer_id,expected_bank_account_id,created_by)
              VALUES(%s,%s,'customer_receipt',%s,%s,%s,%s,%s)""",(tenant,str(data.request_key),amount,data.entry_date,str(customer.id),
              str(data.bank_account_id) if data.bank_account_id else None,str(actor)))
            return {**base,'status':'awaiting_confirmation','allocations':allocations,'payment_method':'Transfer'}
        collection=collection_account(session,'Cash',None)
        postings,advance_posting=_post_parts(session,actor,data.request_key,parts,advance,collection,'Cash',data.entry_date)
        posting={'parts':postings,'advance':advance_posting.get('transaction_no') if advance_posting else None}
        raw(session,"""INSERT INTO accounting.customer_receipt(business_id,id,customer_id,amount,method,entry_date,allocations,advance,status,created_by,posting)
          VALUES(%s,%s,%s,%s,'cash',%s,%s::jsonb,%s,'posted',%s,%s::jsonb)""",(tenant,str(data.request_key),str(customer.id),amount,data.entry_date,
          json.dumps(allocations),advance,str(actor),json.dumps(posting)))
        if advance>0:_record_advance(session,actor,customer.id,data.request_key,advance,data.entry_date,advance_posting)
        return {**base,'status':'posted','allocations':postings,'payment_method':'Cash'}
    return durable(session,actor,'customer_receipt',data,execute)


def _waiting_receipt(session,receipt_id):
    row=raw(session,"SELECT * FROM accounting.customer_receipt WHERE business_id=%s AND id=%s AND status='awaiting_transfer' FOR UPDATE",
            (str(session.business_id),str(receipt_id))).first()
    if not row:raise HTTPException(409,'This payment is no longer waiting for confirmation')
    return row


def confirm_receipt(session,actor,receipt_id,bank,day):
    """Daily reconciliation confirmed the transfer: each part posts into the bank. A part an invoice no longer needs (a
    credit note meanwhile, say) is kept as the customer's advance, so the money is never refused once it has arrived."""
    receipt_id=UUID(str(receipt_id));row=_waiting_receipt(session,receipt_id)
    parts=[];extra=ZERO
    for a in sorted(row.allocations,key=lambda x:x['invoice_id']):
        planned=Decimal(a['amount']);outstanding,waiting=invoice_outstanding(session,UUID(a['invoice_id']))
        part=max(min(planned,outstanding-(waiting-planned)),ZERO);extra+=planned-part
        if part>0:parts.append((UUID(a['invoice_id']),part))
    advance=row.advance+extra
    postings,advance_posting=_post_parts(session,actor,receipt_id,parts,advance,bank,'Transfer',day)
    raw(session,"UPDATE accounting.customer_receipt SET status='posted',bank_account_id=%s,posting=%s::jsonb WHERE business_id=%s AND id=%s",
        (str(bank),json.dumps({'parts':postings,'advance':advance_posting.get('transaction_no') if advance_posting else None}),str(session.business_id),str(receipt_id)))
    if advance>0:_record_advance(session,actor,row.customer_id,receipt_id,advance,day,advance_posting)
    return {'parts':postings,'advance':_money(advance)}


def receipt_not_received(session,receipt_id):
    _waiting_receipt(session,receipt_id)
    raw(session,"UPDATE accounting.customer_receipt SET status='not_received' WHERE business_id=%s AND id=%s",(str(session.business_id),str(receipt_id)))


def _invoice_paid(session,invoice_id,target_remaining):
    raw(session,"UPDATE public.invoices SET status=%s,updated_at=now() WHERE id=%s AND business_id=%s",
        ('paid' if target_remaining==0 else 'sent',str(invoice_id),str(session.business_id)))


def apply_advance(session,actor,invoice_id:UUID,data:AdvanceApply):
    """PR-11: part of the customer's advance pays an invoice: debit Customer deposits, credit their receivable."""
    def execute():
        tenant=str(session.business_id)
        invoice=raw(session,'SELECT customer_id,invoice_number FROM public.invoices WHERE business_id=%s AND id=%s',(tenant,str(invoice_id))).first()
        if not invoice:raise HTTPException(404,'Invoice not found')
        amount=Decimal(data.amount)
        if amount<=0:raise HTTPException(422,'Enter an amount above zero')
        outstanding,waiting=invoice_outstanding(session,invoice_id)
        if amount>outstanding-waiting:raise HTTPException(409,f'Only {_naira(max(outstanding-waiting,ZERO))} is still owed on this invoice')
        held=advance_balance(session,invoice.customer_id)
        if amount>held:raise HTTPException(409,f'This customer holds {_naira(held)} in advance')
        day=business_today(session)
        posting=post_command(session,actor,PostingCommand(request_key=uuid5(data.request_key,'posting'),kind='deposit_application',source_id=data.request_key,
            target_id=invoice_id,main_account_id=party_account(session,'customers',invoice.customer_id),entry_date=day,credited=True,
            narration='Customer advance applied to invoice '+invoice.invoice_number,
            lines=[{'account_id':advances_account(session,actor,False),'amount':_money(amount),'credited':False}]),internal=True)
        raw(session,"""INSERT INTO accounting.customer_advance(business_id,id,customer_id,kind,amount,entry_date,invoice_id,posting,created_by)
          VALUES(%s,%s,%s,'applied',%s,%s,%s,%s::jsonb,%s)""",(tenant,str(data.request_key),str(invoice.customer_id),amount,day,str(invoice_id),
          json.dumps(posting),str(actor)))
        remaining=Decimal(posting['outstanding'])
        _invoice_paid(session,invoice_id,remaining)
        return {'invoice_id':str(invoice_id),'applied':_money(amount),'outstanding':_money(remaining),
                'advance':_money(advance_balance(session,invoice.customer_id)),'transaction_no':posting.get('transaction_no')}
    return durable(session,actor,'advance_apply:'+str(invoice_id),data,execute)


def refund_advance(session,actor,customer_id:UUID,data:AdvanceRefund):
    """Hands an advance back from the till or a bank: debit Customer deposits, credit the till or bank. Owners and Admins."""
    def execute():
        if role(session,actor) not in {'owner','admin'}:raise HTTPException(403,'Only an Owner or Admin can hand back an advance')
        _customer(session,customer_id);amount=Decimal(data.amount)
        if amount<=0:raise HTTPException(422,'Enter an amount above zero')
        held=advance_balance(session,customer_id)
        if amount>held:raise HTTPException(409,f'This customer holds {_naira(held)} in advance')
        paid_from=collection_account(session,data.method,data.bank_account_id);day=business_today(session)
        posting=post_command(session,actor,PostingCommand(request_key=uuid5(data.request_key,'posting'),kind='deposit_settlement',source_id=data.request_key,
            main_account_id=paid_from,entry_date=day,credited=True,narration='Advance handed back: '+data.note,
            lines=[{'account_id':advances_account(session,actor,False),'amount':_money(amount),'credited':False}]),internal=True)
        raw(session,"""INSERT INTO accounting.customer_advance(business_id,id,customer_id,kind,amount,entry_date,note,posting,created_by)
          VALUES(%s,%s,%s,'refunded',%s,%s,%s,%s::jsonb,%s)""",(str(session.business_id),str(data.request_key),str(customer_id),amount,day,data.note,
          json.dumps(posting),str(actor)))
        return {'customer_id':str(customer_id),'refunded':_money(amount),'advance':_money(advance_balance(session,customer_id)),
                'transaction_no':posting.get('transaction_no')}
    return durable(session,actor,'advance_refund:'+str(customer_id),data,execute)


def _bucket(days):
    if days<=0:return 'current'
    if days<=30:return 'd1_30'
    if days<=60:return 'd31_60'
    if days<=90:return 'd61_90'
    return 'over_90'


def _cleared_by(session,as_of):
    rows=raw(session,'SELECT assigned_id,sum(amount) AS amount FROM accounting.assignment WHERE business_id=%s AND assignment_date::date<=%s GROUP BY assigned_id',
             (str(session.business_id),as_of)).all()
    return {r.assigned_id:Decimal(r.amount) for r in rows}


def ageing(session,kind:str,as_of:date):
    """What is owed at a date, by party and by how long it is past its due date (the issue date when it has none)."""
    if kind not in {'receivables','payables'}:raise HTTPException(422,'Choose receivables or payables')
    tenant=str(session.business_id);cleared=_cleared_by(session,as_of)
    if kind=='receivables':
        rows=raw(session,"""SELECT d.source_id,d.transaction_id,i.customer_id AS party_id,i.invoice_number AS number,i.due_date
          FROM accounting.document_map d JOIN public.invoices i ON i.business_id=d.business_id AND i.id=d.source_id
          WHERE d.business_id=%s AND d.source_type='invoice'""",(tenant,)).all()
        names=dict(raw(session,'SELECT id::text,name FROM public.customers WHERE business_id=%s',(tenant,)).all())
    else:
        evidence=raw(session,'SELECT reconciliation_evidence FROM accounting.business_map WHERE business_id=%s',(tenant,)).scalar() or {}
        opening={d['source_id']:d['party_id'] for d in evidence.get('opening_documents',[]) if d.get('type')=='bill'}
        rows=raw(session,"""SELECT d.source_id,d.transaction_id,b.supplier_id AS party_id,b.bill_number AS number,b.due_date
          FROM accounting.document_map d LEFT JOIN accounting.supplier_bill b ON b.business_id=d.business_id AND b.id=d.source_id
          WHERE d.business_id=%s AND d.source_type='bill'""",(tenant,)).all()
        names=dict(raw(session,'SELECT id::text,name FROM public.suppliers WHERE business_id=%s',(tenant,)).all())
    parties={}
    for r in rows:
        tx=session.get(Transaction,r.transaction_id);dated=tx.transaction_date.date()
        if dated>as_of:continue
        owed=tx.amount-cleared.get(tx.id,ZERO)
        if owed<=0:continue
        party=str(r.party_id) if r.party_id else (opening.get(str(r.source_id)) if kind=='payables' else None)
        due=r.due_date or dated;days=(as_of-due).days;bucket=_bucket(days)
        entry=parties.setdefault(party,{'party_id':party,'name':names.get(party,'Unknown '+('customer' if kind=='receivables' else 'supplier')),
                                        **{b:ZERO for b,_ in BUCKETS},'total':ZERO,'documents':[]})
        entry[bucket]+=owed;entry['total']+=owed
        entry['documents'].append({'id':str(r.source_id),'number':r.number or 'Opening balance','date':dated.isoformat(),'due_date':due.isoformat(),
                                   'days_overdue':max(days,0),'bucket':bucket,'outstanding':_money(owed)})
    if kind=='receivables':
        held=raw(session,"""SELECT customer_id::text AS id,sum(CASE WHEN kind='received' THEN amount ELSE -amount END) AS amount
          FROM accounting.customer_advance WHERE business_id=%s AND entry_date<=%s GROUP BY 1""",(tenant,as_of)).all()
        for h in held:
            if Decimal(h.amount)<=0:continue
            entry=parties.setdefault(h.id,{'party_id':h.id,'name':names.get(h.id,'Unknown customer'),**{b:ZERO for b,_ in BUCKETS},'total':ZERO,'documents':[]})
            entry['advance']=Decimal(h.amount)
    result=[];totals={b:ZERO for b,_ in BUCKETS}|{'total':ZERO,'advance':ZERO}
    for entry in sorted(parties.values(),key=lambda e:(-e['total'],e['name'])):
        advance=entry.pop('advance',ZERO)
        for key in totals:totals[key]+=advance if key=='advance' else entry[key]
        entry['documents'].sort(key=lambda d:(-d['days_overdue'],d['date']))
        result.append({**{k:(_money(v) if isinstance(v,Decimal) else v) for k,v in entry.items()},'advance':_money(advance),'net':_money(entry['total']-advance)})
    return {'type':kind,'as_of':as_of.isoformat(),'buckets':[{'key':k,'label':l} for k,l in BUCKETS],'rows':result,
            'totals':{k:_money(v) for k,v in totals.items()}|{'net':_money(totals['total']-totals['advance'])}}


def statement(session,customer_id:UUID,start:date,end:date):
    """A customer's account between two dates: invoices raise what they owe; payments, credit notes, booking deposits
    applied and advances received lower it; advances handed back raise it. Applying an advance moves money the customer
    already paid, so it does not change the balance. Transfers waiting for confirmation are not yet on it."""
    if end<start:raise HTTPException(422,'The end date is before the start date')
    if (end-start).days>3660:raise HTTPException(422,'Choose at most ten years')
    customer=_customer(session,customer_id);tenant=str(session.business_id)
    invoices=raw(session,"""SELECT i.id,i.invoice_number,d.transaction_id FROM public.invoices i
      JOIN accounting.document_map d ON d.business_id=i.business_id AND d.source_type='invoice' AND d.source_id=i.id
      WHERE i.business_id=%s AND i.customer_id=%s""",(tenant,str(customer_id))).all()
    numbers={r.transaction_id:r.invoice_number for r in invoices};events=[]
    for r in invoices:
        tx=session.get(Transaction,r.transaction_id)
        events.append((tx.transaction_date.date(),0,'Invoice',r.invoice_number,tx.amount,ZERO))
    applied={r.transaction_id for r in raw(session,"""SELECT d.transaction_id FROM accounting.document_map d JOIN accounting.customer_advance a
      ON a.business_id=d.business_id AND a.id=d.source_id AND a.kind='applied' WHERE d.business_id=%s AND d.source_type='deposit_application'""",(tenant,)).all()}
    if numbers:
        clearing=raw(session,"""SELECT a.assigned_id,a.transaction_id,a.amount,a.assignment_date,t.transaction_type,t.transaction_no
          FROM accounting.assignment a JOIN accounting."transaction" t ON t.id=a.transaction_id
          WHERE a.business_id=%s AND a.assigned_id = ANY(%s)""",(tenant,list(numbers))).all()
        labels={'CLIENT_RECEIPT':'Payment','CREDIT_NOTE':'Credit note','JOURNAL_ENTRY':'Deposit applied'}
        for c in clearing:
            if c.transaction_id in applied:continue
            kind=getattr(c.transaction_type,'name',str(c.transaction_type))
            events.append((c.assignment_date.date(),1,labels.get(kind,'Payment'),f'{c.transaction_no} for {numbers[c.assigned_id]}',ZERO,Decimal(c.amount)))
    for a in raw(session,'SELECT kind,amount,entry_date,note,posting FROM accounting.customer_advance WHERE business_id=%s AND customer_id=%s AND kind<>%s',
                 (tenant,str(customer_id),'applied')).all():
        reference=(a.posting or {}).get('transaction_no') or ''
        if a.kind=='received':events.append((a.entry_date,1,'Advance received',reference,ZERO,Decimal(a.amount)))
        else:events.append((a.entry_date,2,'Advance handed back',reference,Decimal(a.amount),ZERO))
    events.sort(key=lambda e:(e[0],e[1],e[3]))
    opening=sum((e[4]-e[5] for e in events if e[0]<start),ZERO);balance=opening;lines=[]
    for day,_,kind,reference,debit,credit in events:
        if day<start or day>end:continue
        balance+=debit-credit
        lines.append({'date':day.isoformat(),'kind':kind,'reference':reference,'debit':_money(debit),'credit':_money(credit),'balance':_money(balance)})
    if len(lines)>2000:raise HTTPException(422,'Too many entries; choose a shorter period')
    return {'customer':{'id':str(customer.id),'name':customer.name},'start':start.isoformat(),'end':end.isoformat(),
            'opening':_money(opening),'closing':_money(balance),'lines':lines,'advance_held':_money(advance_balance(session,customer_id,end))}
