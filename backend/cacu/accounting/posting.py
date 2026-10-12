"""Native transaction posting and allocation inside one caller-owned SQL transaction."""
import hashlib
import json
from datetime import date,datetime,time
from decimal import Decimal
from typing import Literal
from uuid import UUID,uuid4
from fastapi import HTTPException
from pydantic import BaseModel,ConfigDict,Field,field_validator
from python_accounting.models import Account,LineItem,Transaction,Assignment
from python_accounting.transactions import (ClientInvoice,ClientReceipt,SupplierBill,SupplierPayment,
    CashPurchase,CashSale,JournalEntry,CreditNote,ContraEntry)

class PostingLine(BaseModel):
    model_config=ConfigDict(extra='forbid')
    account_id:UUID
    amount:str=Field(pattern=r'^[0-9]{1,13}(\.[0-9]{1,2})?$')
    credited:bool=False
    description:str=Field(default='',max_length=500)
    @field_validator('amount')
    @classmethod
    def positive(cls,v):
        if Decimal(v)<=0:raise ValueError('Amount must be positive')
        return v

class StockLine(BaseModel):
    model_config=ConfigDict(extra='forbid')
    item_id:UUID
    quantity:int=Field(gt=0,le=1000000)

class PostingCommand(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_key:UUID
    kind:Literal['invoice','receipt','bill','supplier_payment','expense','pos','adjustment','credit_note','transfer','reversal']
    source_id:UUID
    target_id:UUID|None=None
    main_account_id:UUID
    entry_date:date
    narration:str=Field(min_length=1,max_length=1000)
    credited:bool=True
    main_amount:str|None=Field(default=None,pattern=r'^[0-9]{1,13}(\.[0-9]{1,2})?$')
    lines:list[PostingLine]=Field(min_length=1,max_length=100)
    stock:list[StockLine]=Field(default_factory=list,max_length=100)
    counterparty_id:UUID|None=None
    payment_method:Literal['Cash','Transfer']|None=None

CLASSES={'invoice':ClientInvoice,'receipt':ClientReceipt,'bill':SupplierBill,'supplier_payment':SupplierPayment,
         'expense':CashPurchase,'pos':CashSale,'adjustment':JournalEntry,'credit_note':CreditNote,
         'transfer':ContraEntry,'reversal':JournalEntry}

def raw(session,sql,args=()):
    return session.connection().exec_driver_sql(sql,args)

def account(session,source_id):
    row=raw(session,'SELECT m.library_id FROM accounting.account_map m JOIN public.accounts a ON a.id=m.account_id AND a.business_id=m.business_id WHERE m.business_id=%s AND m.account_id=%s AND a.is_active',
            (str(session.business_id),str(source_id))).first()
    if not row:raise HTTPException(422,'Posting account unavailable for this business')
    obj=session.get(Account,row.library_id)
    if not obj or obj.entity_id!=session.entity.id:raise HTTPException(422,'Account entity mismatch')
    return obj

def native_post(session,cls,main,lines,entry_date,narration,credited=None,main_amount=None):
    kwargs={'account_id':main.id,'transaction_date':datetime.combine(entry_date,time(12)),
            'entity_id':session.entity.id,'narration':narration}
    if credited is not None:kwargs['credited']=credited
    if main_amount is not None:
        kwargs.update(compound=True,main_account_amount=main_amount)
    tx=cls(**kwargs);session.add(tx);session.flush()
    items=[]
    for entry in lines:
        acc,amount,side=entry[:3]
        description=entry[3] if len(entry)>3 else narration
        item=LineItem(narration=description,account_id=acc.id,amount=amount,credited=side,entity_id=session.entity.id)
        session.add(item);session.flush();items.append(item)
    with session.no_autoflush:
        for item in items:tx.line_items.add(item)
    session.flush();tx.post(session);session.flush();session.expire(tx, ['ledgers'])
    return tx

def post_command(session,actor:UUID,command:PostingCommand):
    serialized=command.model_dump(mode='json')
    if serialized.get('payment_method') is None:serialized.pop('payment_method',None)
    payload=json.dumps(serialized,sort_keys=True,separators=(',',':'))
    digest=hashlib.sha256(payload.encode()).hexdigest()
    tenant=str(session.business_id)
    replay=raw(session,'SELECT payload_hash,result FROM accounting.posting_requests WHERE business_id=%s AND request_key=%s',(tenant,str(command.request_key))).first()
    if replay:
        if replay.payload_hash!=digest:raise HTTPException(409,'Idempotency key already used for another request')
        return replay.result
    existing=raw(session,'SELECT transaction_id FROM accounting.document_map WHERE business_id=%s AND source_type=%s AND source_id=%s',
                 (tenant,command.kind,str(command.source_id))).first()
    if existing:raise HTTPException(409,'Source document already posted')
    main=account(session,command.main_account_id)
    lines=[(account(session,l.account_id),Decimal(l.amount),l.credited,l.description or command.narration) for l in command.lines]
    amount=Decimal(command.main_amount) if command.main_amount is not None else sum((l[1] for l in lines),Decimal('0'))
    if command.main_amount is not None and command.kind!='adjustment':raise HTTPException(422,'Compound amounts are only valid for adjustments')
    if command.main_amount is not None and amount<=0:raise HTTPException(422,'Compound main amount must be positive')
    if command.entry_date<raw(session,'SELECT cutover_date FROM accounting.business_map WHERE business_id=%s',(tenant,)).scalar():
        raise HTTPException(409,'Posting predates accounting cutover')
    source=None;target=None
    if command.counterparty_id:
        table='suppliers' if command.kind in {'bill','supplier_payment'} else 'customers'
        party=raw(session,f'SELECT id FROM public.{table} WHERE id=%s AND business_id=%s',(str(command.counterparty_id),tenant)).first()
        if not party:raise HTTPException(422,'Counterparty unavailable for this business')
        mapped=raw(session,'SELECT library_id FROM accounting.party_map WHERE business_id=%s AND party_type=%s AND party_id=%s',
                   (tenant,table,str(command.counterparty_id))).scalar()
        if mapped!=main.id:raise HTTPException(422,'Counterparty account mapping required')
    if command.kind=='invoice':
        source=raw(session,'SELECT total,tax,status,customer_id FROM public.invoices WHERE id=%s AND business_id=%s FOR UPDATE',(str(command.source_id),tenant)).first()
        if not source or source.status!='draft' or source.total!=amount or (source.tax or 0)!=0:
            raise HTTPException(409,'Invoice must be a reconciled tax-free draft matching its authoritative total')
        if str(source.customer_id)!=str(command.counterparty_id):raise HTTPException(422,'Invoice customer mismatch')
    if command.kind in {'receipt','supplier_payment','credit_note'}:
        if not command.target_id:raise HTTPException(422,'Allocation target required')
        kind='bill' if command.kind=='supplier_payment' else 'invoice'
        mapped=raw(session,'SELECT transaction_id FROM accounting.document_map WHERE business_id=%s AND source_type=%s AND source_id=%s',
                   (tenant,kind,str(command.target_id))).scalar()
        target=session.get(Transaction,mapped) if mapped else None
        if not target or target.account_id!=main.id:raise HTTPException(422,'Allocation target/account mismatch')
        if amount>target.amount-target.cleared(session):raise HTTPException(409,'Amount exceeds outstanding balance')
    if command.kind=='transfer' and (main.account_type!=Account.AccountType.BANK or any(entry[0].account_type!=Account.AccountType.BANK for entry in lines)):
        raise HTTPException(422,'Cash transfers require cash accounts')
    if command.kind=='reversal':
        # Reversal receives its own UUID and target is a posted document. Financial
        # legs are derived from the ledger, never supplied correction values.
        if not command.target_id:raise HTTPException(422,'Reversal target required')
        targetrow=raw(session,'SELECT transaction_id FROM accounting.document_map WHERE business_id=%s AND source_id=%s',(tenant,str(command.target_id))).first()
        if not targetrow:raise HTTPException(422,'Posted reversal target required')
        original=session.get(Transaction,targetrow.transaction_id)
        if raw(session,'SELECT 1 FROM accounting.reversal_map WHERE business_id=%s AND original_id=%s',(tenant,original.id)).first():
            raise HTTPException(409,'Document already reversed')
        if original.transaction_type!=Transaction.TransactionType.JOURNAL_ENTRY or original.compound:
            raise HTTPException(409,'Allocated/commercial documents require their credit-note workflow')
        main=session.get(Account,original.account_id)
        lines=[(session.get(Account,l.account_id),l.amount*l.quantity,not l.credited) for l in original.line_items]
        command.credited=not original.credited
        amount=original.amount
    if command.kind in {'receipt','pos'} and command.payment_method is None:
        raise HTTPException(422,'Cash or Transfer collection method required')
    if command.payment_method:
        if command.kind not in {'receipt','pos'} or (command.kind=='receipt' and len(command.lines)!=1):
            raise HTTPException(422,'Collection method requires a single sale or receipt collection account')
        from cacu.accounting.workflows import collection_account
        selected=command.main_account_id if command.kind=='pos' else command.lines[0].account_id
        reviewed=collection_account(session,command.payment_method,selected if command.payment_method=='Transfer' else None)
        if str(reviewed)!=str(selected):raise HTTPException(422,'Collection method/account mismatch')
    tx=native_post(session,CLASSES[command.kind],main,lines,command.entry_date,command.narration,
                   command.credited if command.kind in {'adjustment','reversal'} else None,
                   Decimal(command.main_amount) if command.main_amount is not None else None)
    if target:
        assignment=Assignment(transaction_id=tx.id,assigned_id=target.id,assigned_type=target.__class__.__name__,
                              assignment_date=tx.transaction_date,amount=amount,entity_id=session.entity.id)
        session.add(assignment);session.flush()
    if command.kind=='invoice':
        raw(session,"UPDATE public.invoices SET status='sent',updated_at=now() WHERE business_id=%s AND id=%s",(tenant,str(command.source_id)))
    if command.kind=='receipt':
        # Manual receipts are recorded explicitly as offline payments. Gateway
        # verification remains separate; this never promotes a pending gateway row.
        raw(session,"""INSERT INTO public.payments(id,business_id,reference,purpose,invoice_id,amount,currency,status,channel,customer_email,initialized_by,customer_id)
         VALUES(%s,%s,%s,'invoice',%s,%s,'NGN','success',%s,'',%s,%s)""",
         (str(command.source_id),tenant,'offline-'+str(command.source_id),str(command.target_id),amount,command.payment_method.lower() if command.payment_method else 'offline',str(actor),str(command.counterparty_id) if command.counterparty_id else None))
        remaining=target.amount-target.cleared(session)
        raw(session,"UPDATE public.invoices SET status=%s,updated_at=now() WHERE id=%s AND business_id=%s",('paid' if remaining==0 else 'sent',str(command.target_id),tenant))
    if command.kind=='reversal':
        raw(session,'INSERT INTO accounting.reversal_map(business_id,original_id,reversal_id) VALUES(%s,%s,%s)',(tenant,original.id,tx.id))
    if command.kind in {'invoice','pos'}:
        table='invoice_items' if command.kind=='invoice' else 'transaction_items'
        fk='invoice_id' if command.kind=='invoice' else 'transaction_id'
        actual_stock=raw(session,f"SELECT i.catalog_item_id,sum(i.quantity) quantity FROM public.{table} i JOIN public.catalog_items c ON c.id=i.catalog_item_id AND c.business_id=i.business_id WHERE i.business_id=%s AND i.{fk}=%s AND c.item_type='PRODUCT' GROUP BY i.catalog_item_id",(tenant,str(command.source_id))).all()
        expected={r.catalog_item_id:int(r.quantity) for r in actual_stock}
        if any(Decimal(r.quantity)!=int(r.quantity) for r in actual_stock) or {s.item_id:s.quantity for s in command.stock}!=expected:
            raise HTTPException(422,'Fulfillment must match authoritative document items')
    if command.kind=='pos':
        document=raw(session,'SELECT total FROM public.transactions WHERE id=%s AND business_id=%s FOR UPDATE',(str(command.source_id),tenant)).first()
        if not document or document.total!=amount:raise HTTPException(409,'Sale source total mismatch')
    secondary_transactions=[]
    if command.stock:
        if command.kind not in {'invoice','pos'}:raise HTTPException(422,'Stock fulfillment requires a sale')
        if len({s.item_id for s in command.stock})!=len(command.stock):raise HTTPException(422,'Duplicate stock item')
        cost=Decimal('0')
        for item in sorted(command.stock,key=lambda x:str(x.item_id)):
            row=raw(session,"SELECT stock_quantity,cost_price FROM public.catalog_items WHERE id=%s AND business_id=%s AND item_type='PRODUCT' AND is_active FOR UPDATE",(str(item.item_id),tenant)).first()
            if not row or row.cost_price is None or row.cost_price<0 or (row.stock_quantity or 0)<item.quantity:
                raise HTTPException(409,'Stock or authoritative cost unavailable')
            cost+=row.cost_price*item.quantity
            raw(session,'UPDATE public.catalog_items SET stock_quantity=stock_quantity-%s WHERE id=%s AND business_id=%s',(item.quantity,str(item.item_id),tenant))
            raw(session,'INSERT INTO accounting.stock_event(business_id,source_id,item_id,quantity,unit_cost) VALUES(%s,%s,%s,%s,%s)',
                (tenant,str(command.source_id),str(item.item_id),-item.quantity,row.cost_price))
        if cost:
            mappings=raw(session,"SELECT purpose,library_id FROM accounting.account_map WHERE business_id=%s AND purpose IN ('inventory','cogs')",(tenant,)).all()
            mapped=dict(mappings)
            if set(mapped)!={'inventory','cogs'} or len(mappings)!=2:raise HTTPException(409,'Unique inventory and COGS mappings required')
            cost_tx=native_post(session,JournalEntry,session.get(Account,mapped['inventory']),
                        [(session.get(Account,mapped['cogs']),cost,False)],command.entry_date,'Cost of fulfillment',True)
            secondary_transactions.append(cost_tx.id)
            raw(session,'INSERT INTO accounting.document_map(business_id,source_type,source_id,transaction_id) VALUES(%s,%s,%s,%s)',
                (tenant,command.kind+'_cogs',str(command.source_id),cost_tx.id))
    raw(session,'INSERT INTO accounting.document_map(business_id,source_type,source_id,transaction_id) VALUES(%s,%s,%s,%s)',(tenant,command.kind,str(command.source_id),tx.id))
    result={'source_id':str(command.source_id),'transaction_id':tx.id,'transaction_no':tx.transaction_no,
            'amount':format(amount,'.2f'),'supporting_transaction_ids':secondary_transactions,'outstanding':format(target.amount-target.cleared(session),'.2f') if target else None}
    if command.payment_method:
        result.update(payment_method=command.payment_method,collection_account_id=str(command.main_account_id if command.kind=='pos' else command.lines[0].account_id))
    raw(session,'INSERT INTO accounting.posting_requests(business_id,request_key,payload_hash,result,created_by) VALUES(%s,%s,%s,%s::jsonb,%s)',
        (tenant,str(command.request_key),digest,json.dumps(result),str(actor)))
    raw(session,'INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,%s,%s::jsonb)',
        (tenant,str(actor),str(command.request_key),command.kind,json.dumps(result)))
    return result
