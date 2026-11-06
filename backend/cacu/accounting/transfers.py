"""Transfers awaiting confirmation (BR-010, Doc 09 PR-03 to PR-05, Doc 10 daily reconciliation).

A transfer sale has already posted revenue and stock, with the money in Transfers awaiting confirmation; a transfer
receipt is held without posting. Confirming moves the money to the chosen bank account (PR-04) or posts the held
receipt. "Not received" reverses the sale's revenue and returns its stock at the original cost (PR-05), or simply
drops the held receipt. Each transfer is decided once; a decision is replay-safe under its request key."""
from datetime import date
import json
from decimal import Decimal
from uuid import UUID,uuid5
from fastapi import HTTPException
from pydantic import BaseModel,ConfigDict,Field
from cacu.accounting.posting import PostingCommand,post_command,raw
from cacu.accounting.workflows import (business_today,clearing_account,collection_account,durable,purpose,receipt_posting)
from cacu.accounting import inventory

ZERO=Decimal('0')


class TransferConfirm(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_key:UUID
    bank_account_id:UUID
    note:str=Field(default='',max_length=500)


class TransferNotReceived(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_key:UUID
    note:str=Field(min_length=3,max_length=500)


def _pending(session,transfer_id):
    row=raw(session,'SELECT * FROM accounting.pending_transfer WHERE business_id=%s AND id=%s FOR UPDATE',
            (str(session.business_id),str(transfer_id))).first()
    if not row:raise HTTPException(404,'Transfer not found')
    if row.status!='pending':raise HTTPException(409,'This transfer was already '+('confirmed' if row.status=='confirmed' else 'marked not received'))
    return row


def _decide(session,actor,transfer_id,status,day,bank=None,note=''):
    raw(session,"""UPDATE accounting.pending_transfer SET status=%s,decided_by=%s,decided_at=now(),decided_on=%s,bank_account_id=%s,decision_note=%s
      WHERE business_id=%s AND id=%s""",(status,str(actor),day,str(bank) if bank else None,note or None,str(session.business_id),str(transfer_id)))
    raw(session,'INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,%s,%s::jsonb)',
        (str(session.business_id),str(actor),str(transfer_id),'transfer_'+status,
         json.dumps({'bank_account_id':str(bank) if bank else None,'note':note or None})))


def confirm(session,actor,transfer_id:UUID,data:TransferConfirm):
    def execute():
        row=_pending(session,transfer_id);day=business_today(session)
        bank=collection_account(session,'Transfer',data.bank_account_id)
        amount=format(row.amount,'.2f')
        if row.source_type=='pos':
            # PR-04: debit the bank, credit Transfers awaiting confirmation.
            posting=post_command(session,actor,PostingCommand(request_key=uuid5(data.request_key,'posting'),kind='transfer_confirmation',
                source_id=data.request_key,main_account_id=bank,entry_date=day,credited=False,narration='Transfer received for sale '+str(transfer_id)[:8],
                lines=[{'account_id':clearing_account(session),'amount':amount,'credited':True}]),internal=True)
            raw(session,"UPDATE public.transactions SET status='completed' WHERE business_id=%s AND id=%s",(str(session.business_id),str(transfer_id)))
        else:
            # The held receipt posts now, into the chosen bank, and clears the invoice by that amount.
            posting=receipt_posting(session,actor,transfer_id,row.invoice_id,amount,'Transfer',bank,day)
        _decide(session,actor,transfer_id,'confirmed',day,bank,data.note)
        return {'id':str(transfer_id),'status':'confirmed','posting':posting}
    return durable(session,actor,'transfer_confirm:'+str(transfer_id),data,execute)


def _return_stock(session,actor,sale_id,key,day):
    """Returns a reversed sale's stock at the cost it left at; returns the total cost restored."""
    tenant=str(session.business_id);total=ZERO
    issued=raw(session,'SELECT item_id,-quantity AS quantity,unit_cost FROM accounting.stock_event WHERE business_id=%s AND source_id=%s AND quantity<0 ORDER BY item_id',
               (tenant,str(sale_id))).all()
    for line in issued:
        valuation=inventory.state(session,line.item_id)
        if valuation:
            origin=raw(session,"SELECT * FROM accounting.inventory_value_event WHERE business_id=%s AND source_id=%s AND item_id=%s AND kind='issue'",
                       (tenant,str(sale_id),str(line.item_id))).first()
            if not origin:raise HTTPException(409,'The original valued sale is missing; ask your accountant')
            item=inventory.item(session,line.item_id)
            if item.stock_quantity!=valuation.quantity:raise HTTPException(409,'Stock quantities do not reconcile to valuation')
            gross=-origin.gross_change;allowance=-origin.allowance_change
            inventory.update(session,line.item_id,valuation.quantity+line.quantity,valuation.gross_cost+gross,valuation.allowance+allowance,max(day,valuation.last_date))
            inventory.event(session,actor,uuid5(key,'return:'+str(line.item_id)),line.item_id,'return',max(day,valuation.last_date),line.quantity,gross,allowance,key,
                            {'review':'Transfer not received','original_sale':str(sale_id)},origin.id)
            inventory.allowance_post(session,actor,uuid5(key,'allowance:'+str(line.item_id)),day,allowance,'Return of inventory allowance')
        else:
            gross=(line.unit_cost*line.quantity).quantize(Decimal('0.01'))
        raw(session,'UPDATE public.catalog_items SET stock_quantity=stock_quantity+%s WHERE business_id=%s AND id=%s',(line.quantity,tenant,str(line.item_id)))
        raw(session,'INSERT INTO accounting.stock_event(business_id,source_id,item_id,quantity,unit_cost) VALUES(%s,%s,%s,%s,%s)',
            (tenant,str(key),str(line.item_id),line.quantity,line.unit_cost))
        total+=gross
    if total:
        stock_key=uuid5(key,'stock')
        post_command(session,actor,PostingCommand(request_key=stock_key,source_id=stock_key,kind='adjustment',main_account_id=purpose(session,'inventory'),
            entry_date=day,narration='Stock returned: transfer not received',credited=False,
            lines=[{'account_id':purpose(session,'cogs'),'amount':format(total,'.2f'),'credited':True}]),managed_stock=True)
        raw(session,'INSERT INTO accounting.inventory_journal(business_id,source_id) VALUES(%s,%s)',(tenant,str(stock_key)))
    return total


def not_received(session,actor,transfer_id:UUID,data:TransferNotReceived):
    def execute():
        row=_pending(session,transfer_id);day=business_today(session);posting=None;restored=ZERO
        if row.source_type=='pos':
            # PR-05: debit revenue, credit Transfers awaiting confirmation; the goods come back into stock.
            sale=raw(session,'SELECT payment_method,total FROM public.transactions WHERE business_id=%s AND id=%s FOR UPDATE',(str(session.business_id),str(transfer_id))).one()
            lines=[{'account_id':purpose(session,'revenue'),'amount':format(sale.total,'.2f'),'credited':False}]
            if sale.payment_method=='split':
                # The whole sale is reversed: the customer's cash part is handed back from the till.
                lines.append({'account_id':collection_account(session,'Cash',None),'amount':format(sale.total-row.amount,'.2f'),'credited':True})
            posting=post_command(session,actor,PostingCommand(request_key=uuid5(data.request_key,'posting'),kind='transfer_not_received',
                source_id=data.request_key,main_account_id=clearing_account(session),entry_date=day,credited=True,
                main_amount=format(row.amount,'.2f') if sale.payment_method=='split' else None,
                narration='Transfer not received: '+data.note,lines=lines),internal=True)
            restored=_return_stock(session,actor,transfer_id,data.request_key,day)
            raw(session,"UPDATE public.transactions SET status='reversed' WHERE business_id=%s AND id=%s",(str(session.business_id),str(transfer_id)))
        _decide(session,actor,transfer_id,'not_received',day,None,data.note)
        return {'id':str(transfer_id),'status':'not_received','posting':posting,'stock_cost_restored':format(restored,'.2f'),
                'cash_to_refund':format(sale.total-row.amount,'.2f') if row.source_type=='pos' and sale.payment_method=='split' else None}
    return durable(session,actor,'transfer_not_received:'+str(transfer_id),data,execute)


def list_transfers(session,status='pending',limit=200):
    if status not in {'pending','confirmed','not_received'}:raise HTTPException(422,'Unknown transfer status')
    today=business_today(session)
    rows=raw(session,"""SELECT p.*,i.invoice_number,c.name AS customer_name FROM accounting.pending_transfer p
      LEFT JOIN public.invoices i ON i.business_id=p.business_id AND i.id=p.invoice_id
      LEFT JOIN public.customers c ON c.business_id=p.business_id AND c.id=p.customer_id
      WHERE p.business_id=%s AND p.status=%s ORDER BY p.entry_date,p.created_at LIMIT %s""",(str(session.business_id),status,limit)).all()
    return [{'id':str(r.id),'kind':'sale' if r.source_type=='pos' else 'invoice payment','amount':format(r.amount,'.2f'),
             'entry_date':r.entry_date.isoformat(),'age_days':(today-r.entry_date).days,'invoice_number':r.invoice_number,
             'customer':r.customer_name,'expected_bank_account_id':str(r.expected_bank_account_id) if r.expected_bank_account_id else None,
             'status':r.status,'decided_on':r.decided_on.isoformat() if r.decided_on else None} for r in rows]


def daily(session,day:date):
    """The owner's daily reconciliation (Doc 10): that day's sales by method and every transfer still waiting."""
    rows=raw(session,"""SELECT s.payment_method,s.status,count(*) AS sales,coalesce(sum(s.total),0) AS total,
        coalesce(sum(coalesce(s.transfer_amount,s.total)),0) AS transfer_part
      FROM public.transactions s JOIN accounting.document_map d ON d.business_id=s.business_id AND d.source_id=s.id AND d.source_type='pos'
      JOIN accounting."transaction" t ON t.id=d.transaction_id AND t.business_id=d.business_id
      WHERE s.business_id=%s AND t.transaction_date::date=%s GROUP BY 1,2 ORDER BY 1,2""",(str(session.business_id),day)).all()
    methods={}
    for r in rows:
        entry=methods.setdefault(r.payment_method,{'sales':0,'total':ZERO,'awaiting':ZERO,'reversed':ZERO})
        entry['sales']+=r.sales;entry['total']+=r.total
        if r.status=='pending_payment':entry['awaiting']+=r.transfer_part
        if r.status=='reversed':entry['reversed']+=r.total
    waiting=list_transfers(session,'pending')
    return {'date':day.isoformat(),
            'by_method':{m:{'sales':v['sales'],'total':format(v['total'],'.2f'),'awaiting':format(v['awaiting'],'.2f'),'reversed':format(v['reversed'],'.2f')}
                         for m,v in methods.items()},
            'pending':waiting,'pending_total':format(sum((Decimal(p['amount']) for p in waiting),ZERO),'.2f')}
