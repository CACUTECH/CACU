"""Native transaction posting and allocation inside one caller-owned SQL transaction."""
import hashlib
import json
from datetime import date,datetime,time
from decimal import Decimal
from typing import Literal
from uuid import UUID,uuid4,uuid5
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
    kind:Literal['invoice','receipt','bill','supplier_payment','expense','pos','adjustment','credit_note','transfer','reversal',
                 'transfer_confirmation','transfer_not_received','sale_refund','shift_variance','booking_deposit','deposit_settlement','deposit_application']
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
    payment_method:Literal['Cash','Transfer','Split']|None=None

CLASSES={'invoice':ClientInvoice,'receipt':ClientReceipt,'bill':SupplierBill,'supplier_payment':SupplierPayment,
         'expense':CashPurchase,'pos':CashSale,'adjustment':JournalEntry,'credit_note':CreditNote,
         'transfer':ContraEntry,'reversal':JournalEntry,'transfer_confirmation':JournalEntry,'transfer_not_received':JournalEntry,'sale_refund':JournalEntry,
         'shift_variance':JournalEntry,'booking_deposit':JournalEntry,'deposit_settlement':JournalEntry,
         'deposit_application':JournalEntry}
# Posted only by the transfer (BR-010), refund (PR-16), shift (PR-22) and booking deposit (PR-12) workflows, never
# through the generic postings route.
INTERNAL_KINDS={'transfer_confirmation','transfer_not_received','sale_refund','shift_variance','booking_deposit','deposit_settlement','deposit_application'}

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

CORRECTION_KINDS={'reversal','credit_note'}

def post_command(session,actor:UUID,command:PostingCommand,*,managed_stock=False,internal=False,allow_shortfall=False,preissued=frozenset()):
    # preissued: tracked items a completed job already issued from stock; its invoice or sale charges them without issuing them again.
    if command.kind in INTERNAL_KINDS and not internal:raise HTTPException(422,'Transfers are confirmed from the daily reconciliation screen')
    # Corrections are Owner/Admin-only in their workflows; enforce it here too so the
    # generic postings route cannot reach around them, and before a replay returns.
    if command.kind in CORRECTION_KINDS:
        member=raw(session,'SELECT accounting.lock_membership(%s,%s)',(str(session.business_id),str(actor))).scalar()
        if member not in {'owner','admin'}:raise HTTPException(403,'Only an Owner or Admin can post reversals and credit notes')
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
    split_sale=command.kind=='pos' and command.payment_method=='Split'
    if command.main_amount is not None and command.kind not in {'adjustment','transfer_not_received'} and not split_sale:raise HTTPException(422,'Compound amounts are only valid for adjustments')
    if split_sale and command.main_amount is None:raise HTTPException(422,'A split sale names its cash part')
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
    if command.kind in {'receipt','supplier_payment','credit_note'} or (command.kind=='deposit_application' and command.target_id):
        if not command.target_id:raise HTTPException(422,'Allocation target required')
        kind='bill' if command.kind=='supplier_payment' else 'invoice'
        mapped=raw(session,'SELECT transaction_id FROM accounting.document_map WHERE business_id=%s AND source_type=%s AND source_id=%s',
                   (tenant,kind,str(command.target_id))).scalar()
        target=session.get(Transaction,mapped) if mapped else None
        if not target or target.account_id!=main.id:raise HTTPException(422,'Allocation target/account mismatch')
        if amount>target.amount-target.cleared(session):raise HTTPException(409,'Amount exceeds outstanding balance')
    if command.kind=='transfer' and (main.account_type!=Account.AccountType.BANK or any(entry[0].account_type!=Account.AccountType.BANK for entry in lines)):
        raise HTTPException(422,'Cash transfers require cash accounts')
    compound=Decimal(command.main_amount) if command.main_amount is not None else None
    if command.kind=='reversal':
        # Reversal receives its own UUID and target is a posted document. Financial
        # legs are derived from the ledger, never supplied correction values.
        # Only manual journals and expenses: stock journals are corrected by a stock
        # adjustment (the quantity would otherwise disagree with the ledger), and
        # invoices, bills and their payments by their credit-note workflow.
        if not command.target_id:raise HTTPException(422,'Reversal target required')
        targetrow=raw(session,"""SELECT d.transaction_id FROM accounting.document_map d WHERE d.business_id=%s AND d.source_id=%s
            AND d.source_type IN ('adjustment','expense') AND NOT EXISTS(SELECT FROM accounting.stock_event e WHERE e.business_id=d.business_id AND e.source_id=d.source_id) AND NOT EXISTS(SELECT FROM accounting.inventory_journal j WHERE j.business_id=d.business_id AND j.source_id=d.source_id)""",
            (tenant,str(command.target_id))).first()
        if not targetrow:raise HTTPException(422,'Only posted manual journals and expenses can be reversed')
        original=session.get(Transaction,targetrow.transaction_id)
        if raw(session,'SELECT 1 FROM accounting.reversal_map WHERE business_id=%s AND original_id=%s',(tenant,original.id)).first():
            raise HTTPException(409,'Document already reversed')
        if original.transaction_type not in {Transaction.TransactionType.JOURNAL_ENTRY,Transaction.TransactionType.CASH_PURCHASE}:
            raise HTTPException(409,'Allocated/commercial documents require their credit-note workflow')
        if command.entry_date<original.transaction_date.date():raise HTTPException(409,'A reversal cannot be dated before the original')
        main=session.get(Account,original.account_id)
        lines=[(session.get(Account,l.account_id),l.amount*l.quantity,not l.credited) for l in original.line_items]
        command.credited=not original.credited
        compound=original.main_account_amount if original.compound else None
        amount=original.amount
    if command.kind in {'receipt','pos'} and command.payment_method is None:
        raise HTTPException(422,'Cash or Transfer collection method required')
    if command.payment_method:
        if command.kind not in {'receipt','pos'} or (command.kind=='receipt' and len(command.lines)!=1):
            raise HTTPException(422,'Collection method requires a single sale or receipt collection account')
        from cacu.accounting.workflows import collection_account,purpose
        selected=command.main_account_id if command.kind=='pos' else command.lines[0].account_id
        if split_sale:
            # Cash part into the till, transfer part into Transfers awaiting confirmation (BR-010), revenue credited.
            clearing=str(purpose(session,'transfer_clearing'))
            debits=[l for l in command.lines if not l.credited]
            if str(collection_account(session,'Cash',None))!=str(selected) or len(debits)!=1 or str(debits[0].account_id)!=clearing:
                raise HTTPException(422,'A split sale takes cash into the till and the transfer into Transfers awaiting confirmation')
        elif command.kind=='pos' and command.payment_method=='Transfer':
            # BR-010: a transfer sale waits in "Transfers awaiting confirmation" until the owner confirms it.
            if str(purpose(session,'transfer_clearing'))!=str(selected) or any(not l.credited for l in command.lines):
                raise HTTPException(422,'Transfer sales post to Transfers awaiting confirmation')
        else:
            reviewed=collection_account(session,command.payment_method,selected if command.payment_method=='Transfer' else None)
            if str(reviewed)!=str(selected):raise HTTPException(422,'Collection method/account mismatch')
    if command.kind in INTERNAL_KINDS:
        from cacu.accounting.workflows import collection_account,purpose
        clearing=str(purpose(session,'transfer_clearing'))
        if command.kind=='sale_refund':
            # PR-16: debit revenue, credit the till or the bank the money goes back from.
            cash=str(collection_account(session,'Cash',None))
            paid_from=str(command.main_account_id)
            if paid_from!=cash and str(collection_account(session,'Transfer',command.main_account_id))!=paid_from:
                raise HTTPException(422,'A refund is paid from the till or a bank account')
            if not command.credited or len(command.lines)!=1 or command.lines[0].credited or str(command.lines[0].account_id)!=str(purpose(session,'revenue')):
                raise HTTPException(422,'A refund takes back revenue only')
        elif command.kind in {'booking_deposit','deposit_settlement','deposit_application'}:
            deposits=raw(session,"SELECT account_id FROM accounting.account_map WHERE business_id=%s AND purpose='customer_deposits'",(tenant,)).all()
            if len(deposits)!=1:raise HTTPException(409,'Set up deposits before taking one')
            deposits=str(deposits[0].account_id);main_id=str(command.main_account_id);line=command.lines[0] if len(command.lines)==1 else None
            cash=str(collection_account(session,'Cash',None))
            if command.kind=='booking_deposit':
                # PR-12: debit the till (or Transfers awaiting confirmation), credit Customer deposits and advances.
                if line is None or command.credited or not line.credited or str(line.account_id)!=deposits or main_id not in {cash,clearing}:
                    raise HTTPException(422,'A deposit moves money into the till or Transfers awaiting confirmation and holds it as a customer deposit')
            elif command.kind=='deposit_application':
                # PR-13 at the till: debit the deposit, credit the till or Transfers awaiting confirmation the sale went
                # into. PR-11 on an invoice: debit the deposit, credit the customer's receivable, allocated to the invoice.
                at_till=main_id==deposits and not command.credited and line is not None and line.credited and str(line.account_id) in {cash,clearing} and not command.target_id
                on_invoice=command.target_id is not None and command.credited and line is not None and not line.credited and str(line.account_id)==deposits
                if not(at_till or on_invoice):raise HTTPException(422,'A deposit is applied to a till sale or an invoice')
            else:
                # A refund debits the deposit and credits the till or a bank; a forfeit debits it and credits income.
                income={str(r.account_id) for r in raw(session,"SELECT account_id FROM accounting.account_map WHERE business_id=%s AND purpose IN ('revenue','service_revenue')",(tenant,)).all()}
                refund=line is not None and command.credited and not line.credited and str(line.account_id)==deposits and (main_id==cash or str(collection_account(session,'Transfer',command.main_account_id))==main_id)
                forfeit=line is not None and main_id==deposits and not command.credited and line.credited and str(line.account_id) in income
                if not(refund or forfeit):raise HTTPException(422,'A deposit is either refunded or kept as income')
        elif command.kind=='shift_variance':
            # PR-22: a shortage debits Cash over and short and credits the till; a surplus the reverse.
            variance=raw(session,"SELECT account_id FROM accounting.account_map WHERE business_id=%s AND purpose='cash_variance'",(tenant,)).all()
            if str(command.main_account_id)!=str(collection_account(session,'Cash',None)) or len(command.lines)!=1 or len(variance)!=1                or command.lines[0].credited==command.credited or str(command.lines[0].account_id)!=str(variance[0].account_id):
                raise HTTPException(422,'A shift difference moves money between the till and Cash over and short')
        elif command.kind=='transfer_confirmation':
            # PR-04: debit the chosen bank, credit Transfers awaiting confirmation.
            if str(collection_account(session,'Transfer',command.main_account_id))!=str(command.main_account_id) or command.credited                or len(command.lines)!=1 or str(command.lines[0].account_id)!=clearing or not command.lines[0].credited:
                raise HTTPException(422,'A confirmed transfer moves money from Transfers awaiting confirmation to a bank account')
        elif str(command.main_account_id)!=clearing or not command.credited or len([l for l in command.lines if not l.credited])!=1              or any(l.credited and str(l.account_id)!=str(collection_account(session,'Cash',None)) for l in command.lines):
            # PR-05: debit revenue, credit Transfers awaiting confirmation (and, for a split sale, the cash refunded).
            raise HTTPException(422,'An unconfirmed transfer reverses its sale from Transfers awaiting confirmation')
    if not managed_stock:
        controlled=raw(session,"""SELECT m.library_id FROM accounting.account_map m
          JOIN accounting.inventory_policy p ON p.business_id=m.business_id
          WHERE m.business_id=%s AND (m.purpose='inventory' OR m.account_id=p.allowance_account_id)""",(tenant,)).all()
        protected={r.library_id for r in controlled}
        if main.id in protected or any(line[0].id in protected for line in lines):
            raise HTTPException(409,'Adopted inventory and NRV control accounts require the inventory valuation workflows')
    transfer_sale=command.kind=='pos' and command.payment_method in {'Transfer','Split'}
    cls=JournalEntry if transfer_sale else CLASSES[command.kind]
    side=False if transfer_sale else command.credited if command.kind in {'adjustment','reversal'}|INTERNAL_KINDS else None
    tx=native_post(session,cls,main,lines,command.entry_date,command.narration,side,compound)
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
        actual_stock=raw(session,f"SELECT i.catalog_item_id,sum(i.quantity) quantity FROM public.{table} i JOIN public.catalog_items c ON c.id=i.catalog_item_id AND c.business_id=i.business_id WHERE i.business_id=%s AND i.{fk}=%s AND c.item_type='PRODUCT' AND coalesce((to_jsonb(c)->>'track_stock')::boolean,true) GROUP BY i.catalog_item_id",(tenant,str(command.source_id))).all()
        expected={r.catalog_item_id:int(r.quantity) for r in actual_stock if str(r.catalog_item_id) not in {str(i) for i in preissued}}
        if any(Decimal(r.quantity)!=int(r.quantity) for r in actual_stock) or {s.item_id:s.quantity for s in command.stock}!=expected:
            raise HTTPException(422,'Fulfillment must match authoritative document items')
    if command.kind=='pos':
        sold=sum((l[1] for l in lines if l[2]),Decimal('0')) if split_sale else amount
        document=raw(session,'SELECT total FROM public.transactions WHERE id=%s AND business_id=%s FOR UPDATE',(str(command.source_id),tenant)).first()
        if not document or document.total!=sold:raise HTTPException(409,'Sale source total mismatch')
    secondary_transactions=[]
    if command.stock:
        if command.kind not in {'invoice','pos'}:raise HTTPException(422,'Stock fulfillment requires a sale')
        if len({s.item_id for s in command.stock})!=len(command.stock):raise HTTPException(422,'Duplicate stock item')
        cost=Decimal('0')
        from cacu.accounting.inventory import consume, allowance_post
        for item in sorted(command.stock,key=lambda x:str(x.item_id)):
            row=raw(session,"SELECT stock_quantity,cost_price FROM public.catalog_items WHERE id=%s AND business_id=%s AND item_type='PRODUCT' AND is_active FOR UPDATE",(str(item.item_id),tenant)).first()
            if not row or row.cost_price is None or row.cost_price<0:raise HTTPException(409,'Stock or authoritative cost unavailable')
            on_hand=max(row.stock_quantity or 0,0);issued=item.quantity
            if on_hand<item.quantity:
                # BR-022: only when the owner allows overselling, and never for adopted valuations. Stock stops at zero;
                # only the units on hand are costed; the rest is listed for review before period close (RSK-027).
                adopted=raw(session,'SELECT 1 FROM accounting.inventory_valuation WHERE business_id=%s AND item_id=%s',(tenant,str(item.item_id))).first()
                if not allow_shortfall or adopted or command.kind!='pos':raise HTTPException(409,'Stock or authoritative cost unavailable')
                issued=on_hand
                raw(session,'INSERT INTO accounting.stock_shortfall(business_id,sale_id,item_id,quantity) VALUES(%s,%s,%s,%s)',
                    (tenant,str(command.source_id),str(item.item_id),item.quantity-on_hand))
            if issued==0:continue
            valued=consume(session,actor,command.source_id,item.item_id,issued,command.entry_date)
            cost+=valued[0] if valued is not None else row.cost_price*issued
            if valued is not None and valued[1]:
                allowance_post(session,actor,uuid5(command.source_id,'allowance:'+str(item.item_id)),command.entry_date,-valued[1],'Fulfillment of inventory allowance')
            raw(session,'UPDATE public.catalog_items SET stock_quantity=stock_quantity-%s WHERE id=%s AND business_id=%s',(issued,str(item.item_id),tenant))
            raw(session,'INSERT INTO accounting.stock_event(business_id,source_id,item_id,quantity,unit_cost) VALUES(%s,%s,%s,%s,%s)',
                (tenant,str(command.source_id),str(item.item_id),-issued,row.cost_price))
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
