"""Supplier bills (PR-18) and supplier payments (PR-19).

A bill debits the expense accounts it is for and credits payables for that supplier; a payment debits payables
and credits cash or the bank, allocated to one bill and never more than it still owes. Opening bills posted when
the books were turned on are listed and paid the same way. Goods bought for stock need a goods receipt with
quantities (R2), so bills here post to expense accounts only.
"""
from datetime import date
from decimal import Decimal
from uuid import UUID,uuid5
from fastapi import HTTPException
from pydantic import BaseModel,ConfigDict,Field
from python_accounting.models import Transaction
from cacu.accounting.posting import PostingCommand,post_command,raw
from cacu.accounting.workflows import business_today,collection_account,durable,expense_accounts,party_account,role

AMOUNT=r'^[0-9]{1,13}(\.[0-9]{1,2})?$'

class BillLine(BaseModel):
    model_config=ConfigDict(extra='forbid')
    account_id:UUID
    amount:str=Field(pattern=AMOUNT)
    description:str=Field(default='',max_length=500)

class BillCreate(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_key:UUID
    supplier_id:UUID
    bill_number:str=Field(min_length=1,max_length=100)
    entry_date:date
    due_date:date|None=None
    notes:str=Field(default='',max_length=1000)
    lines:list[BillLine]=Field(min_length=1,max_length=50)

class SupplierPaymentCreate(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_key:UUID
    amount:str=Field(pattern=AMOUNT)
    entry_date:date
    method:str=Field(pattern=r'^(Cash|Transfer)$')
    bank_account_id:UUID|None=None

def _writer(session,actor):
    if role(session,actor) not in {'owner','admin','editor'}:raise HTTPException(403,'Only Owners, Admins and Editors can record bills and payments')

def bill_create(session,actor,data:BillCreate):
    def execute():
        _writer(session,actor)
        tenant=str(session.business_id);number=data.bill_number.strip()
        if not number:raise HTTPException(422,'Enter the supplier\'s bill number')
        if data.entry_date>business_today(session):raise HTTPException(422,'A bill cannot be dated in the future')
        if data.due_date and data.due_date<data.entry_date:raise HTTPException(422,'The due date cannot be before the bill date')
        if any(Decimal(l.amount)<=0 for l in data.lines):raise HTTPException(422,'Enter amounts above zero')
        allowed={a['id'] for a in expense_accounts(session)}
        if any(str(l.account_id) not in allowed for l in data.lines):raise HTTPException(422,'Choose expense accounts from your chart')
        if not raw(session,'SELECT 1 FROM public.suppliers WHERE id=%s AND business_id=%s',(str(data.supplier_id),tenant)).first():
            raise HTTPException(422,'Supplier unavailable')
        if raw(session,'SELECT 1 FROM accounting.supplier_bill WHERE business_id=%s AND supplier_id=%s AND lower(btrim(bill_number))=lower(%s)',
               (tenant,str(data.supplier_id),number)).first():
            raise HTTPException(409,'This supplier\'s bill with that number is already recorded')
        payables=party_account(session,'suppliers',data.supplier_id)
        raw(session,'INSERT INTO accounting.supplier_bill(business_id,id,supplier_id,bill_number,bill_date,due_date,notes,created_by) VALUES(%s,%s,%s,%s,%s,%s,%s,%s)',
            (tenant,str(data.request_key),str(data.supplier_id),number,data.entry_date,data.due_date,data.notes,str(actor)))
        cmd=PostingCommand(request_key=uuid5(data.request_key,'posting'),kind='bill',source_id=data.request_key,main_account_id=payables,
            entry_date=data.entry_date,narration=f'Bill {number}',counterparty_id=data.supplier_id,
            lines=[{'account_id':l.account_id,'amount':l.amount,'description':l.description or f'Bill {number}'} for l in data.lines])
        return {'id':str(data.request_key),'posting':post_command(session,actor,cmd)}
    return durable(session,actor,'bill',data,execute)

def _bill(session,bill_id):
    """The bill's posted transaction and supplier, for recorded and opening bills alike."""
    tenant=str(session.business_id)
    row=raw(session,"SELECT transaction_id FROM accounting.document_map WHERE business_id=%s AND source_type='bill' AND source_id=%s",(tenant,str(bill_id))).first()
    if not row:raise HTTPException(404,'Bill not found')
    supplier=raw(session,'SELECT supplier_id FROM accounting.supplier_bill WHERE business_id=%s AND id=%s',(tenant,str(bill_id))).scalar()
    if supplier is None:
        evidence=raw(session,'SELECT reconciliation_evidence FROM accounting.business_map WHERE business_id=%s',(tenant,)).scalar() or {}
        supplier=next((d['party_id'] for d in evidence.get('opening_documents',[]) if d.get('type')=='bill' and d.get('source_id')==str(bill_id)),None)
    if supplier is None:raise HTTPException(409,'Bill supplier unavailable')
    return session.get(Transaction,row.transaction_id),supplier

def payment_create(session,actor,bill_id:UUID,data:SupplierPaymentCreate):
    def execute():
        _writer(session,actor)
        if Decimal(data.amount)<=0:raise HTTPException(422,'Enter an amount above zero')
        if data.entry_date>business_today(session):raise HTTPException(422,'A payment cannot be dated in the future')
        bill,supplier=_bill(session,bill_id)
        if data.entry_date<bill.transaction_date.date():raise HTTPException(422,'A payment cannot be dated before its bill')
        payables=raw(session,'SELECT account_id FROM accounting.account_map WHERE business_id=%s AND library_id=%s',(str(session.business_id),bill.account_id)).scalar()
        paid_from=collection_account(session,data.method,data.bank_account_id)
        cmd=PostingCommand(request_key=uuid5(data.request_key,'posting'),kind='supplier_payment',source_id=data.request_key,target_id=bill_id,
            main_account_id=payables,entry_date=data.entry_date,narration=f'Payment: {bill.narration}',counterparty_id=supplier,
            lines=[{'account_id':paid_from,'amount':data.amount}])
        return {'id':str(data.request_key),'bill_id':str(bill_id),'posting':post_command(session,actor,cmd)}
    return durable(session,actor,'supplier_payment:'+str(bill_id),data,execute)

def list_bills(session,limit=200):
    tenant=str(session.business_id)
    evidence=raw(session,'SELECT reconciliation_evidence FROM accounting.business_map WHERE business_id=%s',(tenant,)).scalar() or {}
    opening={d['source_id']:d['party_id'] for d in evidence.get('opening_documents',[]) if d.get('type')=='bill'}
    rows=raw(session,"""SELECT d.source_id,d.transaction_id,b.supplier_id,b.bill_number,b.due_date
        FROM accounting.document_map d LEFT JOIN accounting.supplier_bill b ON b.business_id=d.business_id AND b.id=d.source_id
        WHERE d.business_id=%s AND d.source_type='bill' ORDER BY d.transaction_id DESC LIMIT %s""",(tenant,limit)).all()
    names=dict(raw(session,'SELECT id::text,name FROM public.suppliers WHERE business_id=%s',(tenant,)).all())
    result=[]
    for r in rows:
        bill=session.get(Transaction,r.transaction_id)
        supplier=str(r.supplier_id) if r.supplier_id else opening.get(str(r.source_id))
        outstanding=bill.amount-bill.cleared(session)
        result.append({'id':str(r.source_id),'supplier_id':supplier,'supplier_name':names.get(supplier,'Unknown supplier'),
            'bill_number':r.bill_number or 'Opening balance','date':bill.transaction_date.date().isoformat(),
            'due_date':r.due_date.isoformat() if r.due_date else None,'total':format(bill.amount,'.2f'),'outstanding':format(outstanding,'.2f'),
            'status':'paid' if outstanding==0 else 'part_paid' if outstanding<bill.amount else 'unpaid','opening':r.bill_number is None})
    return result
