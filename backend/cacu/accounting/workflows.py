"""CACU document workflows calculate amounts from authoritative records."""
from datetime import date,datetime
from decimal import Decimal
import hashlib,json
from uuid import UUID,uuid5,NAMESPACE_URL
from fastapi import HTTPException
from pydantic import BaseModel,ConfigDict,Field
from cacu.accounting.posting import PostingCommand,StockLine,post_command,raw,account
from python_accounting.models import Account

class InvoiceItem(BaseModel):
    model_config=ConfigDict(extra='forbid')
    catalog_item_id:UUID
    quantity:int=Field(gt=0,le=1000000)
    unit_price:str=Field(pattern=r'^[0-9]{1,13}(\.[0-9]{1,2})?$')

class InvoiceCreate(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_key:UUID
    customer_id:UUID
    invoice_number:str=Field(min_length=1,max_length=100)
    entry_date:date
    due_date:date|None=None
    notes:str=Field(default='',max_length=1000)
    items:list[InvoiceItem]=Field(min_length=1,max_length=100)
    tax:str=Field(default='0.00',pattern=r'^[0-9]{1,13}(\.[0-9]{1,2})?$')
    issue:bool=True

class ReceiptCreate(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_key:UUID
    invoice_id:UUID
    amount:str=Field(pattern=r'^[0-9]{1,13}(\.[0-9]{1,2})?$')
    entry_date:date
    method:str=Field(pattern=r'^(Cash|Transfer|Card)$')
    bank_account_id:UUID|None=None

class SaleCreate(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_key:UUID
    items:list[StockLine]=Field(min_length=1,max_length=100)
    entry_date:date
    method:str=Field(pattern=r'^(Cash|Transfer|Card)$')
    bank_account_id:UUID|None=None
    quoted_total:str=Field(pattern=r'^[0-9]{1,13}(\.[0-9]{1,2})?$')


def purpose(session,name):
    rows=raw(session,'SELECT account_id FROM accounting.account_map WHERE business_id=%s AND purpose=%s',(str(session.business_id),name)).all()
    if len(rows)!=1:raise HTTPException(409,f'One reviewed {name} account mapping required')
    return rows[0].account_id

def collection_account(session,method,bank_account_id):
    if method=='Card':raise HTTPException(409,'Card payments require verified gateway settlement')
    if method=='Transfer':
        if bank_account_id is None:raise HTTPException(422,'Select a bank account for Transfer payments')
        selected=bank_account_id;expected='bank'
    else:
        if bank_account_id is not None:raise HTTPException(422,'Cash payments cannot select a bank account')
        selected=purpose(session,'cash');expected='cash'
    allowed=raw(session,'SELECT accounting.lock_collection_account(%s,%s,%s)',
      (str(session.business_id),str(selected),expected)).scalar()
    if not allowed:raise HTTPException(422,'Collection account unavailable for this business')
    model=account(session,selected)
    if model.deleted_at is not None or model.account_type!=Account.AccountType.BANK or model.currency_id!=session.entity.currency_id:
        raise HTTPException(422,'Reviewed NGN bank or cash account required')
    return selected


def bank_accounts(session):
    rows=raw(session,"""SELECT a.id,a.name FROM accounting.account_map m
      JOIN public.accounts a ON a.id=m.account_id AND a.business_id=m.business_id
      JOIN accounting.account n ON n.id=m.library_id AND n.business_id=m.business_id
      JOIN accounting.recyclable r ON r.id=n.id AND r.business_id=n.business_id
      WHERE m.business_id=%s AND m.purpose='bank' AND m.flow_section='cash'
      AND a.is_active AND n.account_type='BANK' AND n.entity_id=%s
      AND n.currency_id=%s AND r.deleted_at IS NULL
      ORDER BY a.name,a.id LIMIT 101""",(str(session.business_id),session.entity.id,session.entity.currency_id)).all()
    if len(rows)>100:raise HTTPException(409,'Too many bank accounts; refine the reviewed collection list')
    return [{'id':str(row.id),'name':row.name} for row in rows]


def durable(session,actor,kind,data,execute):
    payload=data.model_dump(mode='json')
    # Preserve existing Cash workflow hashes across this additive API change.
    if payload.get('bank_account_id') is None:payload.pop('bank_account_id',None)
    encoded=json.dumps(payload,sort_keys=True,separators=(',',':'))
    digest=hashlib.sha256((kind+encoded).encode()).hexdigest();tenant=str(session.business_id)
    old=raw(session,'SELECT payload_hash,result FROM accounting.workflow_request WHERE business_id=%s AND request_key=%s',(tenant,str(data.request_key))).first()
    if old:
        if old.payload_hash!=digest:raise HTTPException(409,'Workflow idempotency key conflict')
        return old.result
    result=execute()
    raw(session,'INSERT INTO accounting.workflow_request VALUES(%s,%s,%s,%s::jsonb)',(tenant,str(data.request_key),digest,json.dumps(result)))
    return result

def invoice_create(session,actor,data:InvoiceCreate):
    def execute():
        tenant=str(session.business_id)
        if Decimal(data.tax)!=0:raise HTTPException(409,'Taxed invoices require reviewed tax mappings before cutover')
        if len({i.catalog_item_id for i in data.items})!=len(data.items):raise HTTPException(422,'Duplicate invoice item')
        customer=raw(session,'SELECT id FROM public.customers WHERE business_id=%s AND id=%s',(tenant,str(data.customer_id))).first()
        if not customer:raise HTTPException(422,'Customer unavailable')
        ar=raw(session,"SELECT m.account_id FROM accounting.party_map p JOIN accounting.account_map m ON m.library_id=p.library_id AND m.business_id=p.business_id WHERE p.business_id=%s AND p.party_type='customers' AND p.party_id=%s",(tenant,str(data.customer_id))).scalar()
        if not ar:raise HTTPException(409,'Reviewed customer receivable mapping required')
        total=Decimal('0');items=[];stock=[]
        for item in sorted(data.items,key=lambda x:str(x.catalog_item_id)):
            row=raw(session,'SELECT name,item_type,unit_price FROM public.catalog_items WHERE business_id=%s AND id=%s AND is_active FOR UPDATE',(tenant,str(item.catalog_item_id))).first()
            if not row or row.unit_price!=Decimal(item.unit_price) or row.unit_price<=0:raise HTTPException(409,'Invoice price differs from authoritative catalog')
            line_total=row.unit_price*item.quantity;total+=line_total;items.append((item,row.name,line_total))
            if row.item_type=='PRODUCT':stock.append({'item_id':item.catalog_item_id,'quantity':item.quantity})
        raw(session,"INSERT INTO public.invoices(id,business_id,customer_id,invoice_number,status,issue_date,due_date,subtotal,total,tax,notes,type,vat_included) VALUES(%s,%s,%s,%s,'draft',%s,%s,%s,%s,0,%s,'Invoice',false)",
            (str(data.request_key),tenant,str(data.customer_id),data.invoice_number,data.entry_date,data.due_date,total,total,data.notes))
        for item,name,value in items:
            raw(session,'INSERT INTO public.invoice_items(id,business_id,invoice_id,catalog_item_id,description,quantity,unit_price,line_total) VALUES(%s,%s,%s,%s,%s,%s,%s,%s)',
                (str(uuid5(data.request_key,str(item.catalog_item_id))),tenant,str(data.request_key),str(item.catalog_item_id),name,item.quantity,Decimal(item.unit_price),value))
        if not data.issue:return {'id':str(data.request_key),'status':'draft'}
        cmd=PostingCommand(request_key=uuid5(data.request_key,'posting'),kind='invoice',source_id=data.request_key,
            main_account_id=ar,entry_date=data.entry_date,narration=data.invoice_number,counterparty_id=data.customer_id,
            lines=[{'account_id':purpose(session,'revenue'),'amount':format(total,'.2f')}],stock=stock)
        result=post_command(session,actor,cmd)
        return {'id':str(data.request_key),'posting':result}
    return durable(session,actor,'invoice',data,execute)

def receipt_create(session,actor,data:ReceiptCreate):
    def execute():
        tenant=str(session.business_id)
        row=raw(session,"SELECT i.customer_id,m.account_id FROM public.invoices i JOIN accounting.document_map d ON d.business_id=i.business_id AND d.source_id=i.id AND d.source_type='invoice' JOIN accounting.\"transaction\" t ON t.id=d.transaction_id AND t.business_id=d.business_id JOIN accounting.account_map m ON m.business_id=t.business_id AND m.library_id=t.account_id WHERE i.business_id=%s AND i.id=%s FOR UPDATE OF i",
                (tenant,str(data.invoice_id))).first()
        if not row:raise HTTPException(409,'Invoice must be issued before payment')
        collection=collection_account(session,data.method,data.bank_account_id)
        cmd=PostingCommand(request_key=uuid5(data.request_key,'posting'),kind='receipt',source_id=data.request_key,target_id=data.invoice_id,
            main_account_id=row.account_id,counterparty_id=row.customer_id,entry_date=data.entry_date,narration='Manual '+data.method+' receipt',payment_method=data.method,
            lines=[{'account_id':collection,'amount':data.amount}])
        return post_command(session,actor,cmd)
    return durable(session,actor,'receipt',data,execute)

def sale_create(session,actor,data:SaleCreate):
    def execute():
        tenant=str(session.business_id)
        collection=collection_account(session,data.method,data.bank_account_id)
        if len({i.item_id for i in data.items})!=len(data.items):raise HTTPException(422,'Duplicate sale item')
        total=Decimal('0');items=[];stock=[]
        for item in sorted(data.items,key=lambda x:str(x.item_id)):
            row=raw(session,'SELECT name,unit_price,item_type FROM public.catalog_items WHERE id=%s AND business_id=%s AND is_active FOR UPDATE',(str(item.item_id),tenant)).first()
            if not row or row.unit_price<=0:raise HTTPException(409,'Sale item unavailable')
            value=row.unit_price*item.quantity;total+=value;items.append((item,row,value))
            if row.item_type=='PRODUCT':stock.append(item)
        if total!=Decimal(data.quoted_total):raise HTTPException(409,'Checkout total differs from authoritative tax-free prices')
        raw(session,"INSERT INTO public.transactions(id,business_id,created_by,status,payment_method,total,subtotal) VALUES(%s,%s,%s,'completed',%s,%s,%s)",(str(data.request_key),tenant,str(actor),data.method.lower(),total,total))
        for item,row,value in items:
            raw(session,'INSERT INTO public.transaction_items(id,business_id,transaction_id,catalog_item_id,description,quantity,unit_price,line_total) VALUES(%s,%s,%s,%s,%s,%s,%s,%s)',
                (str(uuid5(data.request_key,str(item.item_id))),tenant,str(data.request_key),str(item.item_id),row.name,item.quantity,row.unit_price,value))
        cmd=PostingCommand(request_key=uuid5(data.request_key,'posting'),kind='pos',source_id=data.request_key,
            main_account_id=collection,entry_date=data.entry_date,narration='POS sale',payment_method=data.method,
            lines=[{'account_id':purpose(session,'revenue'),'amount':format(total,'.2f')}],stock=stock)
        return {'saleId':str(data.request_key),'posting':post_command(session,actor,cmd)}
    return durable(session,actor,'pos',data,execute)
