"""Refunds (Doc 10 refunds and voids, Doc 09 PR-16, Doc 08 FR-044), and the day's sales list they start from.

A refund chooses items and quantities from a completed sale, never more than was sold less earlier refunds (pending
ones included). Revenue is taken back at the line's net price, the money goes back from the till or a bank account
(the original method by default), and goods marked resaleable return to stock at the cost they left at. Someone with
sales.approve refunds at once up to the owner's limit; anything above it, and every request from someone without
sales.approve, waits for approval. With separation of duties on (the business's approval rules) nobody approves their
own refund. A refund request is replay-safe under its request key and is decided once."""
from datetime import date
from decimal import Decimal
import json
from typing import Literal
from uuid import UUID,uuid5
from fastapi import HTTPException
from pydantic import BaseModel,ConfigDict,Field
from cacu.accounting.posting import PostingCommand,post_command,raw
from cacu.accounting.session import allowed
from cacu.accounting.workflows import business_today,collection_account,durable,purpose,role
from cacu.accounting import inventory

ZERO=Decimal('0')
AMOUNT=r'^[0-9]{1,13}(\.[0-9]{1,2})?$'
APPROVER_MESSAGE='Only someone who can approve sales (Owner, Admin or Sales manager) can decide refunds'


class RefundLine(BaseModel):
    model_config=ConfigDict(extra='forbid')
    line_id:UUID
    quantity:int=Field(gt=0,le=1000000)
    restock:bool=True


class RefundRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_key:UUID
    lines:list[RefundLine]=Field(min_length=1,max_length=100)
    method:Literal['Cash','Transfer']
    bank_account_id:UUID|None=None
    reason:str=Field(min_length=3,max_length=500)


class RefundDecision(BaseModel):
    model_config=ConfigDict(extra='forbid')
    note:str=Field(default='',max_length=500)
    bank_account_id:UUID|None=None


class RefundPolicy(BaseModel):
    model_config=ConfigDict(extra='forbid')
    refund_threshold:str|None=Field(default=None,pattern=AMOUNT)


def return_stock(session,actor,sale_id,key,day,quantities,review,narration):
    """Returns sold goods to stock at the cost they left at (PR-05, PR-16); quantities maps item to units. Units beyond
    what the sale took from recorded stock, less earlier refunds (an oversold shortfall), are not returned, since they
    never left the records. Returns the cost restored."""
    tenant=str(session.business_id);total=ZERO
    for item_id in sorted(quantities,key=str):
        issued=raw(session,"""SELECT -sum(quantity) AS quantity,max(unit_cost) AS unit_cost FROM accounting.stock_event
          WHERE business_id=%s AND source_id=%s AND item_id=%s AND quantity<0""",(tenant,str(sale_id),str(item_id))).one()
        back=raw(session,"""SELECT coalesce(sum(e.quantity),0) FROM accounting.stock_event e JOIN accounting.sale_refund r
          ON r.business_id=e.business_id AND r.id=e.source_id AND r.status='posted' AND r.sale_id=%s
          WHERE e.business_id=%s AND e.item_id=%s AND e.quantity>0""",(str(sale_id),tenant,str(item_id))).scalar()
        units=min(quantities[item_id],int(issued.quantity or 0)-int(back))
        if units<=0:continue
        valuation=inventory.state(session,item_id)
        if valuation:
            origin=raw(session,"SELECT * FROM accounting.inventory_value_event WHERE business_id=%s AND source_id=%s AND item_id=%s AND kind='issue'",
                       (tenant,str(sale_id),str(item_id))).first()
            if not origin:raise HTTPException(409,'The original valued sale is missing; ask your accountant')
            if inventory.item(session,item_id).stock_quantity!=valuation.quantity:raise HTTPException(409,'Stock quantities do not reconcile to valuation')
            earlier=raw(session,"""SELECT coalesce(sum(quantity),0),coalesce(sum(gross_change),0),coalesce(sum(allowance_change),0)
              FROM accounting.inventory_value_event WHERE business_id=%s AND origin_id=%s AND kind='return'""",(tenant,str(origin.id))).one()
            available=-origin.quantity-earlier[0]
            gross=inventory.proportion(-origin.gross_change-earlier[1],units,available)
            allowance=inventory.proportion(-origin.allowance_change-earlier[2],units,available)
            when=max(day,valuation.last_date)
            inventory.update(session,item_id,valuation.quantity+units,valuation.gross_cost+gross,valuation.allowance+allowance,when)
            inventory.event(session,actor,uuid5(key,'return:'+str(item_id)),item_id,'return',when,units,gross,allowance,key,
                            {'review':review,'original_sale':str(sale_id)},origin.id)
            inventory.allowance_post(session,actor,uuid5(key,'allowance:'+str(item_id)),day,allowance,'Return of inventory allowance')
        else:
            gross=(issued.unit_cost*units).quantize(Decimal('0.01'))
        raw(session,'UPDATE public.catalog_items SET stock_quantity=stock_quantity+%s WHERE business_id=%s AND id=%s',(units,tenant,str(item_id)))
        raw(session,'INSERT INTO accounting.stock_event(business_id,source_id,item_id,quantity,unit_cost) VALUES(%s,%s,%s,%s,%s)',
            (tenant,str(key),str(item_id),units,issued.unit_cost))
        total+=gross
    if total:
        stock_key=uuid5(key,'stock')
        post_command(session,actor,PostingCommand(request_key=stock_key,source_id=stock_key,kind='adjustment',main_account_id=purpose(session,'inventory'),
            entry_date=day,narration=narration,credited=False,
            lines=[{'account_id':purpose(session,'cogs'),'amount':format(total,'.2f'),'credited':True}]),managed_stock=True)
        raw(session,'INSERT INTO accounting.inventory_journal(business_id,source_id) VALUES(%s,%s)',(tenant,str(stock_key)))
    return total


def refund_policy(session):
    row=raw(session,'SELECT refund_threshold FROM accounting.sales_policy WHERE business_id=%s',(str(session.business_id),)).first()
    return {'refund_threshold':format(row.refund_threshold,'.2f') if row and row.refund_threshold is not None else None}


def save_refund_policy(session,actor,data:RefundPolicy):
    if role(session,actor)!='owner':raise HTTPException(403,'Only the business owner can change the refund limit')
    raw(session,"""INSERT INTO accounting.sales_policy(business_id,refund_threshold,updated_by) VALUES(%s,%s,%s)
      ON CONFLICT (business_id) DO UPDATE SET refund_threshold=EXCLUDED.refund_threshold,updated_by=EXCLUDED.updated_by,updated_at=now()""",
        (str(session.business_id),data.refund_threshold,str(actor)))
    result=refund_policy(session)
    raw(session,"INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,gen_random_uuid(),'refund_policy',%s::jsonb)",
        (str(session.business_id),str(actor),json.dumps(result)))
    return result


def _sale(session,sale_id,lock=False):
    sale=raw(session,f"""SELECT s.id,s.status,s.payment_method,s.total,s.refunded_total,t.transaction_no,t.transaction_date::date AS sold_on
      FROM public.transactions s JOIN accounting.document_map d ON d.business_id=s.business_id AND d.source_id=s.id AND d.source_type='pos'
      JOIN accounting."transaction" t ON t.id=d.transaction_id AND t.business_id=d.business_id
      WHERE s.business_id=%s AND s.id=%s{' FOR UPDATE OF s' if lock else ''}""",(str(session.business_id),str(sale_id))).first()
    if not sale:raise HTTPException(404,'Sale not found')
    return sale


def _lines(session,sale_id):
    return raw(session,"""SELECT i.id,i.catalog_item_id,i.description,i.quantity,i.line_total,
        (c.item_type='PRODUCT' AND coalesce(c.track_stock,true)) AS tracked,
        coalesce(sum(l.quantity) FILTER (WHERE r.status IN ('pending','posted')),0) AS taken,
        coalesce(sum(l.amount) FILTER (WHERE r.status IN ('pending','posted')),0) AS taken_amount
      FROM public.transaction_items i JOIN public.catalog_items c ON c.business_id=i.business_id AND c.id=i.catalog_item_id
      LEFT JOIN accounting.sale_refund_line l ON l.business_id=i.business_id AND l.line_id=i.id
      LEFT JOIN accounting.sale_refund r ON r.business_id=l.business_id AND r.id=l.refund_id
      WHERE i.business_id=%s AND i.transaction_id=%s GROUP BY i.id,c.item_type,c.track_stock ORDER BY i.description""",
      (str(session.business_id),str(sale_id))).all()


def _refundable_sale(sale):
    if sale.status=='pending_payment':raise HTTPException(409,"This sale's transfer is still awaiting confirmation. Confirm it or mark it not received first.")
    if sale.status not in {'completed','refunded'}:raise HTTPException(409,'This sale was reversed and cannot be refunded')


def refundable(session,sale_id:UUID):
    """What can still be refunded on a sale, line by line, and the method the money goes back by unless changed."""
    sale=_sale(session,sale_id)
    lines=[{'line_id':str(r.id),'item_id':str(r.catalog_item_id),'name':r.description,'quantity':int(r.quantity),
            'refundable':int(r.quantity)-int(r.taken),'refundable_amount':format(r.line_total-r.taken_amount,'.2f'),'restockable':bool(r.tracked)}
           for r in _lines(session,sale_id)]
    return {'sale_id':str(sale.id),'number':sale.transaction_no,'date':sale.sold_on.isoformat(),'status':sale.status,'method':sale.payment_method,
            'default_method':'Transfer' if sale.payment_method=='transfer' else 'Cash','total':format(sale.total,'.2f'),
            'refunded_total':format(sale.refunded_total,'.2f'),'lines':lines,**refund_policy(session),
            'can_approve':bool(allowed(session,'sales.approve'))}


def _post(session,actor,refund_id,bank,note):
    tenant=str(session.business_id)
    refund=raw(session,'SELECT * FROM accounting.sale_refund WHERE business_id=%s AND id=%s FOR UPDATE',(tenant,str(refund_id))).one()
    _refundable_sale(_sale(session,refund.sale_id,lock=True))
    if refund.method=='transfer' and bank is None:raise HTTPException(422,'Choose the bank account the refund is paid from')
    day=business_today(session)
    paid_from=collection_account(session,'Cash',None) if refund.method=='cash' else collection_account(session,'Transfer',bank)
    # PR-16: debit revenue, credit the till or the bank.
    posting=post_command(session,actor,PostingCommand(request_key=uuid5(refund_id,'posting'),kind='sale_refund',source_id=refund_id,
        main_account_id=paid_from,entry_date=day,credited=True,narration='Refund for sale '+str(refund.sale_id)[:8]+': '+refund.reason,
        lines=[{'account_id':purpose(session,'revenue'),'amount':format(refund.amount,'.2f'),'credited':False}]),internal=True)
    back={}
    for line in raw(session,'SELECT item_id,quantity FROM accounting.sale_refund_line WHERE business_id=%s AND refund_id=%s AND restock',(tenant,str(refund_id))).all():
        back[line.item_id]=back.get(line.item_id,0)+line.quantity
    restored=return_stock(session,actor,refund.sale_id,refund_id,day,back,'Refund: '+refund.reason,'Stock returned: refund') if back else ZERO
    detail={'transaction_no':posting['transaction_no'],'stock_cost_restored':format(restored,'.2f')}
    if refund.method=='cash':
        # Doc 12 UJ-06: cash paid back from a till comes out of the requester's open shift, else the approver's.
        from cacu.accounting.shifts import tag
        shift=tag(session,[refund.requested_by,actor],'refund',refund_id,-refund.amount)
        if shift:detail['shift_id']=str(shift)
    raw(session,"""UPDATE accounting.sale_refund SET status='posted',decided_by=%s,decided_at=now(),decided_on=%s,bank_account_id=%s,decision_note=%s,posting=%s::jsonb
      WHERE business_id=%s AND id=%s""",(str(actor),day,str(bank) if refund.method=='transfer' else None,note or None,json.dumps(detail),tenant,str(refund_id)))
    raw(session,"UPDATE public.transactions SET refunded_total=refunded_total+%s,status='refunded' WHERE business_id=%s AND id=%s",
        (refund.amount,tenant,str(refund.sale_id)))
    raw(session,'INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,%s,%s::jsonb)',
        (tenant,str(actor),str(refund_id),'refund_posted',json.dumps({'sale_id':str(refund.sale_id),'amount':format(refund.amount,'.2f'),**detail})))


def request(session,actor,sale_id:UUID,data:RefundRequest):
    def execute():
        tenant=str(session.business_id)
        sale=_sale(session,sale_id,lock=True);_refundable_sale(sale)
        if not data.reason.strip():raise HTTPException(422,'Say why the sale is refunded')
        if len({l.line_id for l in data.lines})!=len(data.lines):raise HTTPException(422,'Each item appears once in a refund')
        lines={str(r.id):r for r in _lines(session,sale_id)}
        chosen=[];amount=ZERO
        for line in data.lines:
            row=lines.get(str(line.line_id))
            if not row:raise HTTPException(422,'That item is not on this sale')
            left=int(row.quantity)-int(row.taken)
            if line.quantity>left:raise HTTPException(409,f'Only {left} x {row.description} can still be refunded' if left else f'{row.description} has already been refunded')
            value=inventory.proportion(row.line_total-row.taken_amount,line.quantity,left)
            chosen.append((line,row,value));amount+=value
        if amount<=0:raise HTTPException(422,'A refund must be for more than zero')
        bank=None
        if data.bank_account_id is not None:
            if data.method!='Transfer':raise HTTPException(422,'Cash refunds come from the till, not a bank account')
            bank=collection_account(session,'Transfer',data.bank_account_id)
        raw(session,"""INSERT INTO accounting.sale_refund(business_id,id,sale_id,amount,method,bank_account_id,reason,requested_by)
          VALUES(%s,%s,%s,%s,%s,%s,%s,%s)""",(tenant,str(data.request_key),str(sale_id),amount,data.method.lower(),str(bank) if bank else None,data.reason.strip(),str(actor)))
        for line,row,value in chosen:
            raw(session,'INSERT INTO accounting.sale_refund_line(business_id,refund_id,line_id,item_id,quantity,amount,restock) VALUES(%s,%s,%s,%s,%s,%s,%s)',
                (tenant,str(data.request_key),str(line.line_id),str(row.catalog_item_id),line.quantity,value,line.restock and bool(row.tracked)))
        limit=refund_policy(session)['refund_threshold']
        direct=bool(allowed(session,'sales.approve')) and (limit is None or amount<=Decimal(limit))
        raw(session,'INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,%s,%s::jsonb)',
            (tenant,str(actor),str(data.request_key),'refund_requested',json.dumps({'sale_id':str(sale_id),'amount':format(amount,'.2f'),'direct':direct})))
        if direct:_post(session,actor,data.request_key,bank,'Within the refund limit')
        return _read(session,data.request_key,actor)
    return durable(session,actor,'sale_refund:'+str(sale_id),data,execute)


def decide(session,actor,refund_id:UUID,approve:bool,data:RefundDecision):
    tenant=str(session.business_id);refund_id=UUID(str(refund_id))
    row=raw(session,'SELECT status,requested_by,method,bank_account_id FROM accounting.sale_refund WHERE business_id=%s AND id=%s FOR UPDATE',(tenant,str(refund_id))).first()
    if not row:raise HTTPException(404,'Refund not found')
    own=str(row.requested_by)==str(actor)
    # The requester may withdraw their own request; deciding anyone else's, or approving, needs sales.approve.
    if not(own and not approve) and not allowed(session,'sales.approve'):raise HTTPException(403,APPROVER_MESSAGE)
    if row.status!='pending':raise HTTPException(409,f'This refund was already {row.status}')
    from cacu.accounting.stock import policy as approval_rules
    if approve and own and approval_rules(session)['separation_of_duties']:raise HTTPException(403,'Someone other than the requester must approve this refund')
    if not approve and not data.note.strip() and not own:raise HTTPException(422,'Say why the refund is rejected')
    if approve:
        if data.bank_account_id is not None and row.method!='transfer':raise HTTPException(422,'Cash refunds come from the till, not a bank account')
        _post(session,actor,refund_id,data.bank_account_id or row.bank_account_id,data.note.strip())
    else:
        raw(session,"UPDATE accounting.sale_refund SET status='rejected',decided_by=%s,decided_at=now(),decided_on=%s,decision_note=%s WHERE business_id=%s AND id=%s",
            (str(actor),business_today(session),data.note.strip() or 'Withdrawn by the requester',tenant,str(refund_id)))
        raw(session,'INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,%s,%s::jsonb)',
            (tenant,str(actor),str(refund_id),'refund_rejected',json.dumps({'note':data.note.strip()})))
    return _read(session,refund_id,actor)


REFUND_SELECT="""SELECT r.*,t.transaction_no AS sale_number,coalesce(nullif(to_jsonb(m)->>'display_name',''),'A team member') AS requested_by_name,
    (SELECT string_agg(l.quantity||' x '||i.description,', ' ORDER BY i.description) FROM accounting.sale_refund_line l
       JOIN public.transaction_items i ON i.business_id=l.business_id AND i.id=l.line_id WHERE l.business_id=r.business_id AND l.refund_id=r.id) AS items
  FROM accounting.sale_refund r
  JOIN accounting.document_map d ON d.business_id=r.business_id AND d.source_id=r.sale_id AND d.source_type='pos'
  JOIN accounting."transaction" t ON t.id=d.transaction_id AND t.business_id=d.business_id
  LEFT JOIN public.memberships m ON m.business_id=r.business_id AND m.user_id=r.requested_by"""


def _row(r,actor=None):
    return {'id':str(r.id),'sale_id':str(r.sale_id),'sale_number':r.sale_number,'amount':format(r.amount,'.2f'),'method':r.method,
            'items':r.items,'reason':r.reason,'status':r.status,'requested_by_name':r.requested_by_name,'requested_at':r.requested_at.isoformat(),
            'decided_on':r.decided_on.isoformat() if r.decided_on else None,'decision_note':r.decision_note,
            'bank_account_id':str(r.bank_account_id) if r.bank_account_id else None,'posting':r.posting,
            'mine':actor is not None and str(r.requested_by)==str(actor)}


def _read(session,refund_id,actor=None):
    return _row(raw(session,REFUND_SELECT+' WHERE r.business_id=%s AND r.id=%s',(str(session.business_id),str(refund_id))).one(),actor)


def list_refunds(session,status='pending',actor=None,limit=200):
    if status not in {'pending','posted','rejected'}:raise HTTPException(422,'Unknown refund status')
    rows=raw(session,REFUND_SELECT+' WHERE r.business_id=%s AND r.status=%s ORDER BY r.requested_at DESC LIMIT %s',(str(session.business_id),status,limit)).all()
    return [_row(r,actor) for r in rows]


def refunds_on(session,day:date):
    """Refunds paid out on a day, by method, for daily reconciliation."""
    rows=raw(session,"""SELECT method,count(*) AS refunds,sum(amount) AS total FROM accounting.sale_refund
      WHERE business_id=%s AND status='posted' AND decided_on=%s GROUP BY method""",(str(session.business_id),day)).all()
    return {r.method:{'refunds':r.refunds,'total':format(r.total,'.2f')} for r in rows}


def sales_on(session,day:date,limit=200):
    """The day's till sales, newest first, to open a receipt or start a refund."""
    rows=raw(session,"""SELECT s.id,s.status,s.payment_method,s.total,s.refunded_total,t.transaction_no
      FROM public.transactions s JOIN accounting.document_map d ON d.business_id=s.business_id AND d.source_id=s.id AND d.source_type='pos'
      JOIN accounting."transaction" t ON t.id=d.transaction_id AND t.business_id=d.business_id
      WHERE s.business_id=%s AND t.transaction_date::date=%s ORDER BY t.id DESC LIMIT %s""",(str(session.business_id),day,limit)).all()
    return [{'id':str(r.id),'number':r.transaction_no,'status':r.status,'method':r.payment_method,'total':format(r.total,'.2f'),
             'refunded_total':format(r.refunded_total,'.2f')} for r in rows]
