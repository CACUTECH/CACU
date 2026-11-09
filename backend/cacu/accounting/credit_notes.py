"""Credit notes on invoices (Doc 10 E12, Doc 02 BP-06, Doc 09 PR-16 and ACC-010, Doc 11 POST /credit-notes).

A credit note corrects an issued invoice without changing it. Each line either gives units back (credited at what is
left on the line per unit; tracked goods marked resaleable return to stock at the cost they left at) or takes an amount
off the line (a price allowance). It is never more than the invoice charged, less earlier credit notes (waiting ones
included) and earlier returns recorded from the stock valuation screen.

An Owner or Admin posts it at once up to the owner's refund limit; above it, and for anyone else who can post invoices,
it waits for an Owner or Admin. With separation of duties on (the business's approval rules) nobody approves their own.
Posting debits revenue and credits the customer's receivable, allocated to the invoice, up to what is still owed. The
rest, when the invoice was already paid, is kept as the customer's advance (debit revenue, credit Customer deposits and
advances), to apply to another invoice or hand back (E11). A credit note is replay-safe under its request key, numbered
CN-0001 onwards, and decided once."""
from decimal import Decimal
import json
from uuid import UUID,uuid5
from fastapi import HTTPException
from pydantic import BaseModel,ConfigDict,Field
from python_accounting.models import Transaction
from cacu.accounting.posting import PostingCommand,post_command,raw
from cacu.accounting.session import allowed
from cacu.accounting.workflows import business_today,durable,purpose,role
from cacu.accounting import inventory
from cacu.accounting.refunds import refund_policy,return_stock

ZERO=Decimal('0')
AMOUNT=r'^[0-9]{1,13}(\.[0-9]{1,2})?$'
APPROVERS={'owner','admin'}
APPROVER_MESSAGE='Only an Owner or Admin can approve credit notes'


class CreditLine(BaseModel):
    model_config=ConfigDict(extra='forbid')
    line_id:UUID
    quantity:int=Field(default=0,ge=0,le=1000000)
    amount:str|None=Field(default=None,pattern=AMOUNT)
    restock:bool=True


class CreditRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_key:UUID
    invoice_id:UUID
    lines:list[CreditLine]=Field(min_length=1,max_length=100)
    reason:str=Field(min_length=3,max_length=500)


class CreditDecision(BaseModel):
    model_config=ConfigDict(extra='forbid')
    note:str=Field(default='',max_length=500)


def _money(value):
    return format(Decimal(value),'.2f')


def _naira(value):
    return '₦'+format(Decimal(value),',.2f')


def _invoice(session,invoice_id,lock=False):
    row=raw(session,f"""SELECT i.id,i.invoice_number,i.customer_id,i.status,i.total,i.credited_total,i.issue_date,c.name AS customer_name,d.transaction_id
      FROM public.invoices i LEFT JOIN accounting.document_map d ON d.business_id=i.business_id AND d.source_id=i.id AND d.source_type='invoice'
      LEFT JOIN public.customers c ON c.business_id=i.business_id AND c.id=i.customer_id
      WHERE i.business_id=%s AND i.id=%s{' FOR UPDATE OF i' if lock else ''}""",(str(session.business_id),str(invoice_id))).first()
    if not row:raise HTTPException(404,'Invoice not found')
    if row.transaction_id is None or row.status=='draft':raise HTTPException(409,'Only an issued invoice can be credited. Change or delete a draft instead.')
    if row.status=='void':raise HTTPException(409,'This invoice was cancelled and cannot be credited')
    if row.customer_id is None:raise HTTPException(409,'This invoice has no customer to credit')
    return row


def _lines(session,invoice_id):
    """Each invoice line with what earlier credit notes (waiting or posted) and stock-screen returns have taken."""
    tenant=str(session.business_id)
    return raw(session,"""WITH screen AS (
        SELECT e.item_id,sum(e.quantity) AS quantity,
          sum(coalesce((e.evidence->>'credit_amount')::numeric,0)+coalesce((e.evidence->>'refund_amount')::numeric,0)) AS amount
        FROM accounting.inventory_value_event e WHERE e.business_id=%s AND e.kind='return' AND e.evidence->>'original_sale'=%s
          AND NOT EXISTS (SELECT FROM accounting.invoice_credit c WHERE c.business_id=e.business_id AND c.id=e.source_id)
        GROUP BY e.item_id)
      SELECT i.id,i.catalog_item_id,i.description,i.quantity,i.line_total,
        (c.item_type='PRODUCT' AND coalesce(c.track_stock,true)) AS tracked,
        coalesce(sum(l.quantity) FILTER (WHERE r.status IN ('pending','posted')),0)+coalesce(max(s.quantity),0) AS taken,
        coalesce(sum(l.amount) FILTER (WHERE r.status IN ('pending','posted')),0)+coalesce(max(s.amount),0) AS taken_amount
      FROM public.invoice_items i LEFT JOIN public.catalog_items c ON c.business_id=i.business_id AND c.id=i.catalog_item_id
      LEFT JOIN accounting.invoice_credit_line l ON l.business_id=i.business_id AND l.line_id=i.id
      LEFT JOIN accounting.invoice_credit r ON r.business_id=l.business_id AND r.id=l.credit_id
      LEFT JOIN screen s ON s.item_id=i.catalog_item_id
      WHERE i.business_id=%s AND i.invoice_id=%s GROUP BY i.id,c.item_type,c.track_stock ORDER BY i.description,i.id""",
      (tenant,str(invoice_id),tenant,str(invoice_id))).all()


def _outstanding(session,invoice):
    target=session.get(Transaction,invoice.transaction_id)
    return target,target.amount-target.cleared(session)


def _can_approve(session,actor):
    return role(session,actor) in APPROVERS


def creditable(session,invoice_id:UUID,actor):
    """What can still be credited on an invoice, line by line, what is still owed, and who may approve."""
    invoice=_invoice(session,invoice_id);_,owed=_outstanding(session,invoice)
    lines=[]
    for r in _lines(session,invoice_id):
        units=int(r.quantity)-int(r.taken);left=max(r.line_total-r.taken_amount,ZERO)
        lines.append({'line_id':str(r.id),'item_id':str(r.catalog_item_id) if r.catalog_item_id else None,'name':r.description,'quantity':int(r.quantity),
                      'line_total':_money(r.line_total),'creditable_units':max(units,0),'creditable_amount':_money(left),'restockable':bool(r.tracked)})
    return {'invoice_id':str(invoice.id),'invoice_number':invoice.invoice_number,'customer_id':str(invoice.customer_id),'customer_name':invoice.customer_name,
            'total':_money(invoice.total),'credited_total':_money(invoice.credited_total),'outstanding':_money(owed),'lines':lines,
            **refund_policy(session),'can_approve':_can_approve(session,actor)}


def _account_of(session,library_id):
    return raw(session,'SELECT account_id FROM accounting.account_map WHERE business_id=%s AND library_id=%s',(str(session.business_id),library_id)).scalar()


def _revenue(session,target):
    """The income account the invoice credited, so the credit note takes back the same revenue."""
    accounts={l.account_id for l in target.line_items}
    if len(accounts)==1:
        mapped=_account_of(session,accounts.pop())
        if mapped:return mapped
    return purpose(session,'revenue')


def _post(session,actor,credit_id,note):
    tenant=str(session.business_id)
    credit=raw(session,'SELECT * FROM accounting.invoice_credit WHERE business_id=%s AND id=%s FOR UPDATE',(tenant,str(credit_id))).one()
    invoice=_invoice(session,credit.invoice_id,lock=True)
    target,owed=_outstanding(session,invoice)
    day=max(business_today(session),invoice.issue_date)
    against=min(credit.amount,max(owed,ZERO));excess=credit.amount-against
    revenue=_revenue(session,target);narration=f'{credit.number} for invoice {invoice.invoice_number}: {credit.reason}'
    detail={'credit_note':None,'advance':None}
    if against>0:
        # PR-16: debit revenue, credit the customer's receivable, allocated to the invoice.
        posted=post_command(session,actor,PostingCommand(request_key=uuid5(credit_id,'posting'),kind='credit_note',source_id=credit_id,target_id=credit.invoice_id,
            main_account_id=_account_of(session,target.account_id),counterparty_id=invoice.customer_id,entry_date=day,narration=narration,
            lines=[{'account_id':revenue,'amount':_money(against)}]))
        detail['credit_note']=posted['transaction_no']
    if excess>0:
        # The invoice was already paid (or partly): the rest is the customer's to use or have back (E11).
        from cacu.accounting.receivables import advances_account
        key=uuid5(credit_id,'advance')
        kept=post_command(session,actor,PostingCommand(request_key=key,kind='credit_advance',source_id=key,main_account_id=advances_account(session,actor,True),
            entry_date=day,credited=True,narration=narration+' (kept as advance)',lines=[{'account_id':revenue,'amount':_money(excess),'credited':False}]),internal=True)
        detail['advance']=kept['transaction_no']
        raw(session,"""INSERT INTO accounting.customer_advance(business_id,id,customer_id,kind,amount,entry_date,credit_id,note,posting,created_by)
          VALUES(%s,%s,%s,'received',%s,%s,%s,%s,%s::jsonb,%s)""",(tenant,str(key),str(invoice.customer_id),excess,day,str(credit_id),
          'From credit note '+credit.number,json.dumps(kept),str(actor)))
    back={}
    for line in raw(session,'SELECT item_id,quantity FROM accounting.invoice_credit_line WHERE business_id=%s AND credit_id=%s AND restock',(tenant,str(credit_id))).all():
        back[line.item_id]=back.get(line.item_id,0)+line.quantity
    restored=return_stock(session,actor,credit.invoice_id,credit_id,day,back,f'Credit note {credit.number}: {credit.reason}',
                          'Stock returned: credit note '+credit.number,returns='invoice') if back else ZERO
    detail['stock_cost_restored']=_money(restored)
    raw(session,"""UPDATE accounting.invoice_credit SET status='posted',decided_by=%s,decided_at=now(),decided_on=%s,decision_note=%s,
      against_invoice=%s,to_advance=%s,posting=%s::jsonb WHERE business_id=%s AND id=%s""",
        (str(actor),day,note or None,against,excess,json.dumps(detail),tenant,str(credit_id)))
    remaining=target.amount-target.cleared(session)
    raw(session,'UPDATE public.invoices SET credited_total=credited_total+%s,status=%s,updated_at=now() WHERE business_id=%s AND id=%s',
        (credit.amount,'paid' if remaining<=0 else 'sent',tenant,str(credit.invoice_id)))
    raw(session,'INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,%s,%s::jsonb)',
        (tenant,str(actor),str(credit_id),'credit_note_posted',json.dumps({'invoice_id':str(credit.invoice_id),'number':credit.number,
         'amount':_money(credit.amount),'against_invoice':_money(against),'to_advance':_money(excess),**detail})))


def _next_number(session):
    tenant=str(session.business_id)
    raw(session,'SELECT pg_advisory_xact_lock(hashtextextended(%s,0))',(tenant+':credit-note-number',))
    last=raw(session,"SELECT coalesce(max(substring(number from 4)::int),0) FROM accounting.invoice_credit WHERE business_id=%s",(tenant,)).scalar()
    return f'CN-{int(last)+1:04d}'


def request(session,actor,data:CreditRequest):
    def execute():
        tenant=str(session.business_id)
        if not allowed(session,'invoices.post'):raise HTTPException(403,'Only someone who can post invoices can ask for a credit note')
        invoice=_invoice(session,data.invoice_id,lock=True)
        reason=data.reason.strip()
        if len(reason)<3:raise HTTPException(422,'Say why the invoice is credited')
        if len({l.line_id for l in data.lines})!=len(data.lines):raise HTTPException(422,'Each invoice line appears once in a credit note')
        lines={str(r.id):r for r in _lines(session,data.invoice_id)}
        chosen=[];amount=ZERO
        for line in data.lines:
            row=lines.get(str(line.line_id))
            if not row:raise HTTPException(422,'That line is not on this invoice')
            units=int(row.quantity)-int(row.taken);left=row.line_total-row.taken_amount
            if line.quantity:
                if line.amount is not None:raise HTTPException(422,f'For {row.description}, give back units or take an amount off, not both')
                if line.quantity>units:raise HTTPException(409,f'Only {units} x {row.description} can still be credited' if units>0 else f'{row.description} has already been credited in full')
                value=inventory.proportion(left,line.quantity,units) if left>0 else ZERO
                if value<=0:raise HTTPException(409,f'Nothing is left to credit on {row.description}')
                restock=line.restock and bool(row.tracked)
            else:
                if line.amount is None or Decimal(line.amount)<=0:raise HTTPException(422,f'Enter the units given back or the amount taken off {row.description}')
                value=Decimal(line.amount)
                if value>left:raise HTTPException(409,f'At most {_naira(max(left,ZERO))} can still be taken off {row.description}')
                restock=False
            chosen.append((line,row,value,restock));amount+=value
        if amount<=0:raise HTTPException(422,'A credit note must be for more than zero')
        number=_next_number(session)
        raw(session,"""INSERT INTO accounting.invoice_credit(business_id,id,number,invoice_id,customer_id,amount,reason,requested_by)
          VALUES(%s,%s,%s,%s,%s,%s,%s,%s)""",(tenant,str(data.request_key),number,str(data.invoice_id),str(invoice.customer_id),amount,reason,str(actor)))
        for line,row,value,restock in chosen:
            raw(session,'INSERT INTO accounting.invoice_credit_line(business_id,credit_id,line_id,item_id,quantity,amount,restock) VALUES(%s,%s,%s,%s,%s,%s,%s)',
                (tenant,str(data.request_key),str(line.line_id),str(row.catalog_item_id),line.quantity,value,restock))
        limit=refund_policy(session)['refund_threshold']
        direct=_can_approve(session,actor) and (limit is None or amount<=Decimal(limit))
        raw(session,'INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,%s,%s::jsonb)',
            (tenant,str(actor),str(data.request_key),'credit_note_requested',json.dumps({'invoice_id':str(data.invoice_id),'number':number,'amount':_money(amount),'direct':direct})))
        if direct:_post(session,actor,data.request_key,'Within the refund limit')
        return _read(session,data.request_key,actor)
    return durable(session,actor,'invoice_credit',data,execute)


def decide(session,actor,credit_id:UUID,approve:bool,data:CreditDecision):
    tenant=str(session.business_id);credit_id=UUID(str(credit_id))
    if not allowed(session,'invoices.post'):raise HTTPException(403,APPROVER_MESSAGE)
    row=raw(session,'SELECT status,requested_by FROM accounting.invoice_credit WHERE business_id=%s AND id=%s FOR UPDATE',(tenant,str(credit_id))).first()
    if not row:raise HTTPException(404,'Credit note not found')
    own=str(row.requested_by)==str(actor)
    # The requester may withdraw their own request; deciding anyone else's, or approving, needs an Owner or Admin.
    if not(own and not approve) and not _can_approve(session,actor):raise HTTPException(403,APPROVER_MESSAGE)
    if row.status!='pending':raise HTTPException(409,f'This credit note was already {row.status}')
    from cacu.accounting.stock import policy as approval_rules
    if approve and own and approval_rules(session)['separation_of_duties']:raise HTTPException(403,'Someone other than the requester must approve this credit note')
    if not approve and not data.note.strip() and not own:raise HTTPException(422,'Say why the credit note is rejected')
    if approve:_post(session,actor,credit_id,data.note.strip())
    else:
        raw(session,"UPDATE accounting.invoice_credit SET status='rejected',decided_by=%s,decided_at=now(),decided_on=%s,decision_note=%s WHERE business_id=%s AND id=%s",
            (str(actor),business_today(session),data.note.strip() or 'Withdrawn by the requester',tenant,str(credit_id)))
        raw(session,'INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,%s,%s::jsonb)',
            (tenant,str(actor),str(credit_id),'credit_note_rejected',json.dumps({'note':data.note.strip()})))
    return _read(session,credit_id,actor)


CREDIT_SELECT="""SELECT r.*,i.invoice_number,c.name AS customer_name,coalesce(nullif(to_jsonb(m)->>'display_name',''),'A team member') AS requested_by_name,
    (SELECT string_agg(CASE WHEN l.quantity>0 THEN l.quantity||' x '||ii.description ELSE 'Off '||ii.description END,', ' ORDER BY ii.description)
       FROM accounting.invoice_credit_line l JOIN public.invoice_items ii ON ii.business_id=l.business_id AND ii.id=l.line_id
       WHERE l.business_id=r.business_id AND l.credit_id=r.id) AS items
  FROM accounting.invoice_credit r
  JOIN public.invoices i ON i.business_id=r.business_id AND i.id=r.invoice_id
  LEFT JOIN public.customers c ON c.business_id=r.business_id AND c.id=r.customer_id
  LEFT JOIN public.memberships m ON m.business_id=r.business_id AND m.user_id=r.requested_by"""


def _row(r,actor=None):
    return {'id':str(r.id),'number':r.number,'invoice_id':str(r.invoice_id),'invoice_number':r.invoice_number,'customer_id':str(r.customer_id),
            'customer_name':r.customer_name,'amount':_money(r.amount),'items':r.items,'reason':r.reason,'status':r.status,
            'requested_by_name':r.requested_by_name,'requested_at':r.requested_at.isoformat(),
            'decided_on':r.decided_on.isoformat() if r.decided_on else None,'decision_note':r.decision_note,
            'against_invoice':_money(r.against_invoice) if r.against_invoice is not None else None,
            'to_advance':_money(r.to_advance) if r.to_advance is not None else None,'posting':r.posting,
            'mine':actor is not None and str(r.requested_by)==str(actor)}


def _read(session,credit_id,actor=None):
    return _row(raw(session,CREDIT_SELECT+' WHERE r.business_id=%s AND r.id=%s',(str(session.business_id),str(credit_id))).one(),actor)


def list_credits(session,status='pending',actor=None,invoice_id:UUID|None=None,limit=200):
    if status not in {'pending','posted','rejected','all'}:raise HTTPException(422,'Unknown credit note status')
    where=' WHERE r.business_id=%s';args=[str(session.business_id)]
    if status!='all':where+=' AND r.status=%s';args.append(status)
    if invoice_id is not None:where+=' AND r.invoice_id=%s';args.append(str(invoice_id))
    rows=raw(session,CREDIT_SELECT+where+' ORDER BY r.requested_at DESC LIMIT %s',(*args,limit)).all()
    return {'can_approve':_can_approve(session,actor),'credit_notes':[_row(r,actor) for r in rows]}
