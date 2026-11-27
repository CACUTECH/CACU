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
                 'transfer_confirmation','transfer_not_received','sale_refund','shift_variance','booking_deposit','deposit_settlement','deposit_application','goods_bill','customer_advance','gateway_receipt','gateway_settlement','credit_advance','wht_deduction',
                 'payroll','payroll_payment','payroll_remittance','asset_purchase','asset_opening','depreciation','asset_disposal',
                 'asset_removal','payroll_reversal','income_tax_accrual','income_tax_payment','tax_reversal']
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
         'deposit_application':JournalEntry,'goods_bill':JournalEntry,'customer_advance':JournalEntry,
         'gateway_receipt':JournalEntry,'gateway_settlement':JournalEntry,'credit_advance':JournalEntry,'wht_deduction':JournalEntry,
         'payroll':JournalEntry,'payroll_payment':JournalEntry,'payroll_remittance':JournalEntry,
         'asset_purchase':JournalEntry,'asset_opening':JournalEntry,'depreciation':JournalEntry,'asset_disposal':JournalEntry,
         'asset_removal':JournalEntry,'payroll_reversal':JournalEntry,
         'income_tax_accrual':JournalEntry,'income_tax_payment':JournalEntry,'tax_reversal':JournalEntry}
# Documents filed under another document type: a bill for received goods is a supplier bill to payments and the bills list.
DOCUMENT_TYPES={'goods_bill':'bill'}
# Posted only by the transfer (BR-010), refund (PR-16), shift (PR-22) and booking deposit (PR-12) workflows, never
# through the generic postings route.
INTERNAL_KINDS={'transfer_confirmation','transfer_not_received','sale_refund','shift_variance','booking_deposit','deposit_settlement','deposit_application','goods_bill','customer_advance',
                'gateway_receipt','gateway_settlement','credit_advance','wht_deduction','payroll','payroll_payment','payroll_remittance',
                'asset_purchase','asset_opening','depreciation','asset_disposal','asset_removal','payroll_reversal',
                'income_tax_accrual','income_tax_payment','tax_reversal'}
# Reversing journals built by mirror() from a posted entry: corrections of fixed assets and payroll payments.
MIRROR_KINDS={'asset_removal','payroll_reversal','tax_reversal'}
# Fixed assets (R4): the cost and accumulated depreciation account of each category.
ASSET_CATEGORIES=('buildings','vehicles','machinery','furniture','computers','other')
ASSET_COST={f'asset_{c}' for c in ASSET_CATEGORIES}
ASSET_DEPRECIATION={f'accdep_{c}' for c in ASSET_CATEGORIES}
# Payroll to the books (FR-203): the liabilities a run creates and its payments and remittances clear.
PAYROLL_LIABILITIES={'salaries_payable','paye_payable','pension_payable','nhf_payable','nhis_payable'}

def _till(session):
    """The till's account, or None for a business without one: entries that move no cash (or move it through a bank)
    must not need it."""
    from cacu.accounting.workflows import collection_account
    try:
        return str(collection_account(session,'Cash',None))
    except HTTPException:
        return None

def raw(session,sql,args=()):
    return session.connection().exec_driver_sql(sql,args)

def vat_account_id(session,purpose_name):
    return raw(session,'SELECT account_id FROM accounting.account_map WHERE business_id=%s AND purpose=%s',(str(session.business_id),purpose_name)).scalar()

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

def mirror(session,actor,transaction_id,kind,request_key,source_id,entry_date,narration,target_id=None):
    """Posts the exact reverse of a posted entry, dated entry_date: every leg on the other side. For corrections of
    records that are fixed once made (fixed assets, payroll payments), which keep the original and add its reverse."""
    if kind not in MIRROR_KINDS:raise HTTPException(422,'Not a correction')
    original=session.get(Transaction,transaction_id)
    if original is None or original.entity_id!=session.entity.id:raise HTTPException(404,'Entry not found')
    source={r.library_id:r.account_id for r in raw(session,'SELECT library_id,account_id FROM accounting.account_map WHERE business_id=%s',(str(session.business_id),)).all()}
    lines=[{'account_id':source[li.account_id],'amount':format(li.amount*li.quantity,'.2f'),'credited':not li.credited,'description':li.narration or narration}
           for li in original.line_items]
    command=PostingCommand(request_key=request_key,kind=kind,source_id=source_id,target_id=target_id,main_account_id=source[original.account_id],
        entry_date=entry_date,narration=narration,credited=not original.credited,
        main_amount=format(original.main_account_amount,'.2f') if original.compound else None,lines=lines)
    return post_command(session,actor,command,internal=True)

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
                 (tenant,DOCUMENT_TYPES.get(command.kind,command.kind),str(command.source_id))).first()
    if existing:raise HTTPException(409,'Source document already posted')
    main=account(session,command.main_account_id)
    lines=[(account(session,l.account_id),Decimal(l.amount),l.credited,l.description or command.narration) for l in command.lines]
    amount=Decimal(command.main_amount) if command.main_amount is not None else sum((l[1] for l in lines),Decimal('0'))
    split_sale=command.kind=='pos' and command.payment_method=='Split'
    # VAT (E14 R3 2a): only sales and invoices charge output VAT here; such a document posts as one balanced entry.
    vat_output=raw(session,"SELECT library_id FROM accounting.account_map WHERE business_id=%s AND purpose='vat_output'",(tenant,)).scalar()
    # Paying VAT to the tax office debits it; only a sale or an invoice credits it, with exactly one VAT line.
    charged=[l for l in lines if vat_output is not None and l[0].id==vat_output and l[2]]
    vat_legs=charged if command.kind in {'invoice','pos'} else []
    charged_vat=sum((l[1] for l in vat_legs),Decimal('0'))
    if charged and (command.kind not in {'invoice','pos','asset_disposal'} or len(charged)!=1):
        raise HTTPException(422,'Output VAT is charged only by sales and invoices')
    # Input VAT (2b): only a bill or an expense claims it, with one VAT line; a reclaim or settlement credits it.
    vat_input=raw(session,"SELECT library_id FROM accounting.account_map WHERE business_id=%s AND purpose='vat_input'",(tenant,)).scalar()
    claimed=[l for l in lines if vat_input is not None and l[0].id==vat_input and not l[2]] if command.kind!='reversal' else []
    if claimed and (command.kind not in {'bill','goods_bill','expense','asset_purchase'} or len(claimed)!=1):
        raise HTTPException(422,'Input VAT is claimed only on bills and expenses')
    if command.main_amount is not None and command.kind not in {'adjustment','transfer_not_received','payroll','asset_disposal'}|MIRROR_KINDS and not split_sale:raise HTTPException(422,'Compound amounts are only valid for adjustments')
    if split_sale and command.main_amount is None:raise HTTPException(422,'A split sale names its cash part')
    if command.main_amount is not None and amount<=0:raise HTTPException(422,'Compound main amount must be positive')
    if command.entry_date<raw(session,'SELECT cutover_date FROM accounting.business_map WHERE business_id=%s',(tenant,)).scalar():
        raise HTTPException(409,'Posting predates accounting cutover')
    source=None;target=None
    if command.counterparty_id:
        table='suppliers' if command.kind in {'bill','supplier_payment','goods_bill'} else 'customers'
        party=raw(session,f'SELECT id FROM public.{table} WHERE id=%s AND business_id=%s',(str(command.counterparty_id),tenant)).first()
        if not party:raise HTTPException(422,'Counterparty unavailable for this business')
        mapped=raw(session,'SELECT library_id FROM accounting.party_map WHERE business_id=%s AND party_type=%s AND party_id=%s',
                   (tenant,table,str(command.counterparty_id))).scalar()
        if mapped!=main.id:raise HTTPException(422,'Counterparty account mapping required')
    if command.kind=='invoice':
        source=raw(session,'SELECT total,tax,status,customer_id FROM public.invoices WHERE id=%s AND business_id=%s FOR UPDATE',(str(command.source_id),tenant)).first()
        if not source or source.status!='draft' or source.total!=amount or (source.tax or 0)!=charged_vat:
            raise HTTPException(409,'Invoice must be a reconciled draft matching its authoritative total and VAT')
        if str(source.customer_id)!=str(command.counterparty_id):raise HTTPException(422,'Invoice customer mismatch')
    if command.kind in {'receipt','supplier_payment','credit_note','wht_deduction'} or (command.kind in {'deposit_application','gateway_receipt','asset_removal'} and command.target_id):
        if not command.target_id:raise HTTPException(422,'Allocation target required')
        # Removing an asset bought on credit clears its supplier bill, as a payment would.
        kind='bill' if command.kind in {'supplier_payment','asset_removal'} else 'invoice'
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
            income=[l for l in command.lines if str(l.account_id)!=str(vat_account_id(session,'vat_output'))]
            if not command.credited or len(income)!=1 or any(l.credited for l in command.lines) or len(command.lines)>2 or str(income[0].account_id)!=str(purpose(session,'revenue')):
                raise HTTPException(422,'A refund takes back revenue, and any VAT on it')
        elif command.kind in {'booking_deposit','deposit_settlement','deposit_application','customer_advance'}:
            deposits=raw(session,"SELECT account_id FROM accounting.account_map WHERE business_id=%s AND purpose='customer_deposits'",(tenant,)).all()
            if len(deposits)!=1:raise HTTPException(409,'Set up deposits before taking one')
            deposits=str(deposits[0].account_id);main_id=str(command.main_account_id);line=command.lines[0] if len(command.lines)==1 else None
            cash=str(collection_account(session,'Cash',None))
            if command.kind=='booking_deposit':
                # PR-12: debit the till (or Transfers awaiting confirmation), credit Customer deposits and advances.
                if line is None or command.credited or not line.credited or str(line.account_id)!=deposits or main_id not in {cash,clearing}:
                    raise HTTPException(422,'A deposit moves money into the till or Transfers awaiting confirmation and holds it as a customer deposit')
            elif command.kind=='customer_advance':
                # PR-10: money paid beyond a customer's invoices, debit the till or the bank it arrived in, credit
                # Customer deposits and advances.
                # An online payment beyond the invoice (E23) arrives in Card and online payments clearing.
                online=raw(session,"SELECT account_id FROM accounting.account_map WHERE business_id=%s AND purpose='gateway_clearing'",(tenant,)).scalar()
                into_bank=main_id!=cash and (main_id==str(online) or str(collection_account(session,'Transfer',command.main_account_id))==main_id)
                if line is None or command.credited or not line.credited or str(line.account_id)!=deposits or not(main_id==cash or into_bank):
                    raise HTTPException(422,'An advance moves money into the till or a bank account and holds it for the customer')
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
        elif command.kind in {'gateway_receipt','gateway_settlement'}:
            online=raw(session,"SELECT account_id FROM accounting.account_map WHERE business_id=%s AND purpose='gateway_clearing'",(tenant,)).all()
            if len(online)!=1:raise HTTPException(409,'Connect Paystack first: it adds Card and online payments clearing to your chart')
            online=str(online[0].account_id)
            if command.kind=='gateway_receipt':
                # PR-14: debit Card and online payments clearing, credit the customer's receivable, allocated to the invoice.
                if not command.target_id or not command.credited or len(command.lines)!=1 or command.lines[0].credited or str(command.lines[0].account_id)!=online:
                    raise HTTPException(422,'A verified online payment moves the invoice into Card and online payments clearing')
            else:
                # PR-15: debit the bank (net) and Bank and payment charges (fee), credit clearing (gross).
                fees={str(r.account_id) for r in raw(session,"SELECT account_id FROM accounting.account_map WHERE business_id=%s AND purpose='gateway_fees'",(tenant,)).all()}
                banks=[l for l in command.lines if str(l.account_id) not in fees]
                if str(command.main_account_id)!=online or not command.credited or any(l.credited for l in command.lines) or len(banks)!=1                    or len(command.lines)-len(banks)>1 or str(collection_account(session,'Transfer',banks[0].account_id))!=str(banks[0].account_id):
                    raise HTTPException(422,'A settlement moves money from Card and online payments clearing to the bank, less the fee')
        elif command.kind=='payroll':
            # FR-203: credit Salaries payable with the net pay owed (the main account), debit salary expense and
            # employer pension, credit PAYE, pension, NHF and NHIS payable. The payroll workflow builds the lines from
            # the approved run; here the shape is checked so nothing else can be posted under this kind.
            liabilities={str(vat_account_id(session,p)) for p in PAYROLL_LIABILITIES-{'salaries_payable'}}
            if str(command.main_account_id)!=str(vat_account_id(session,'salaries_payable')) or not command.credited or command.main_amount is None                or any(l.credited and str(l.account_id) not in liabilities for l in command.lines) or not any(not l.credited for l in command.lines):
                raise HTTPException(422,'A payroll journal credits net pay to Salaries payable and each deduction to its liability')
        elif command.kind in {'payroll_payment','payroll_remittance'}:
            # Paying staff clears Salaries payable; a remittance clears PAYE, pension, NHF or NHIS payable. Both are
            # paid from the till or a reviewed bank account.
            owed={'salaries_payable'} if command.kind=='payroll_payment' else PAYROLL_LIABILITIES-{'salaries_payable'}
            cash=_till(session)
            paid_from=str(command.main_account_id)
            from_bank=paid_from!=cash and str(collection_account(session,'Transfer',command.main_account_id))==paid_from
            if not command.credited or len(command.lines)!=1 or command.lines[0].credited or not(paid_from==cash or from_bank)                or str(command.lines[0].account_id) not in {str(vat_account_id(session,p)) for p in owed}:
                raise HTTPException(422,'A payroll payment moves money from the till or a bank to clear what is owed')
        elif command.kind in {'asset_purchase','asset_opening','depreciation','asset_disposal'}:
            # Fixed assets (R4). The assets workflow builds these; here the shape is checked so nothing else can be
            # posted under these kinds.
            def ids(purposes):
                return {str(r.account_id) for r in raw(session,'SELECT account_id FROM accounting.account_map WHERE business_id=%s AND purpose=ANY(%s)',(tenant,list(purposes))).all()}
            cost,accdep=ids(ASSET_COST),ids(ASSET_DEPRECIATION)
            main_id=str(command.main_account_id)
            cash=_till(session)
            def till_or_bank(account_id):
                return str(account_id)==cash or str(collection_account(session,'Transfer',account_id))==str(account_id)
            if command.kind=='asset_purchase':
                # Bought and paid: debit the asset's cost (and any input VAT, checked above), credit the till or a bank.
                bought=[l for l in command.lines if not (claimed and str(l.account_id)==str(vat_account_id(session,'vat_input')))]
                ok=command.credited and len(bought)==1 and not bought[0].credited and str(bought[0].account_id) in cost and till_or_bank(command.main_account_id)
            elif command.kind=='asset_opening':
                # Owned before the books started: debit its cost, credit its depreciation to date and retained earnings.
                allowed=accdep|ids({'retained_earnings'})
                ok=not command.credited and main_id in cost and all(l.credited and str(l.account_id) in allowed for l in command.lines)
            elif command.kind=='depreciation':
                # A month's depreciation: debit Depreciation, credit each category's accumulated depreciation.
                ok=not command.credited and main_id in ids({'depreciation'}) and all(l.credited and str(l.account_id) in accdep for l in command.lines)
            else:
                # A disposal: credit the cost; debit its depreciation and any proceeds; the difference is a gain or loss.
                gains=ids({'disposal_gains'});output=str(vat_account_id(session,'vat_output'))
                ok=command.credited and main_id in cost and command.main_amount is not None and all(
                    str(l.account_id) in gains or (l.credited and str(l.account_id)==output)
                    or (not l.credited and (str(l.account_id) in accdep or till_or_bank(l.account_id))) for l in command.lines)
            if not ok:raise HTTPException(422,'Fixed asset entries are posted by the fixed assets workflow')
        elif command.kind in {'income_tax_accrual','income_tax_payment'}:
            # Income tax in the books (R4): the year's tax debits Income tax expense and credits Income tax payable and
            # any WHT credits used; paying it debits Income tax payable from the till or a bank.
            payable=str(vat_account_id(session,'income_tax'))
            if command.kind=='income_tax_accrual':
                allowed={payable,str(vat_account_id(session,'wht_receivable'))}
                ok=not command.credited and str(command.main_account_id)==str(vat_account_id(session,'income_tax_expense')) and all(l.credited and str(l.account_id) in allowed for l in command.lines)
            else:
                cash=_till(session);paid_from=str(command.main_account_id)
                from_bank=paid_from!=cash and str(collection_account(session,'Transfer',command.main_account_id))==paid_from
                ok=command.credited and len(command.lines)==1 and not command.lines[0].credited and str(command.lines[0].account_id)==payable and (paid_from==cash or from_bank)
            if not ok:raise HTTPException(422,'Income tax entries are posted by the income tax workflow')
        elif command.kind in MIRROR_KINDS:
            # Built only by mirror(), from the posted entry being reversed; nothing else posts these.
            if not command.lines:raise HTTPException(422,'A correction reverses a posted entry')
        elif command.kind=='wht_deduction':
            # Doc 09 PR-33 (E14 R3 2c): WHT a customer deducted debits WHT credits (1320) and credits their receivable,
            # allocated to the invoice like the cash they paid. Treatment to be confirmed by the reviewer.
            if not command.credited or len(command.lines)!=1 or command.lines[0].credited or str(command.lines[0].account_id)!=str(vat_account_id(session,'wht_receivable')):
                raise HTTPException(422,'WHT moves an amount from the customer to WHT credits')
        elif command.kind=='credit_advance':
            # PR-16 on a paid invoice: the part of a credit note beyond what the invoice still owed debits revenue and
            # credits Customer deposits and advances, kept for the customer (E11).
            deposits=raw(session,"SELECT account_id FROM accounting.account_map WHERE business_id=%s AND purpose='customer_deposits'",(tenant,)).all()
            income={str(r.account_id) for r in raw(session,"SELECT account_id FROM accounting.account_map WHERE business_id=%s AND purpose IN ('revenue','service_revenue')",(tenant,)).all()}
            taken=[l for l in command.lines if str(l.account_id)!=str(vat_account_id(session,'vat_output'))]  # and any VAT on it (2c)
            if len(deposits)!=1 or str(command.main_account_id)!=str(deposits[0].account_id) or not command.credited or len(taken)!=1 or len(command.lines)>2                or any(l.credited for l in command.lines) or str(taken[0].account_id) not in income or command.counterparty_id is not None:
                raise HTTPException(422,'A credit kept as advance takes back revenue into Customer deposits and advances')
        elif command.kind=='goods_bill':
            # A bill for received goods: debit Goods received not invoiced, credit the supplier's payables (matched by
            # counterparty); price differences are separate stock adjustments.
            grni=raw(session,"SELECT account_id FROM accounting.account_map WHERE business_id=%s AND purpose='grni'",(tenant,)).all()
            # With VAT (E14 R3 2b), the second line is the input VAT on the bill, checked above.
            goods=[l for l in command.lines if not (claimed and str(l.account_id)==str(vat_account_id(session,'vat_input')))]
            if len(grni)!=1 or not command.counterparty_id or not command.credited or len(goods)!=1 or goods[0].credited                or str(goods[0].account_id)!=str(grni[0].account_id):
                raise HTTPException(422,'A bill for received goods clears Goods received not invoiced against the supplier')
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
    # A credit note that gives back VAT (2c) is one entry too: revenue and Output VAT debited, the receivable credited.
    returned=[l for l in lines if vat_output is not None and l[0].id==vat_output and not l[2]] if command.kind=='credit_note' else []
    if len(returned)>1:raise HTTPException(422,'A credit note gives back VAT on one line')
    cls=JournalEntry if transfer_sale or vat_legs or claimed or returned else CLASSES[command.kind]
    # A taxed bill or expense credits payables or the bank; a taxed sale or invoice debits the till, bank or receivable.
    side=True if claimed or returned else False if transfer_sale or vat_legs else command.credited if command.kind in {'adjustment','reversal'}|INTERNAL_KINDS else None
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
            row=raw(session,"SELECT name,stock_quantity,cost_price FROM public.catalog_items WHERE id=%s AND business_id=%s AND item_type='PRODUCT' AND is_active FOR UPDATE",(str(item.item_id),tenant)).first()
            if not row or row.cost_price is None or row.cost_price<0:raise HTTPException(409,'Stock or authoritative cost unavailable')
            on_hand=max(row.stock_quantity or 0,0);issued=item.quantity
            # Part 4a: with outlets, only what the selling outlet holds can be sold from it.
            from cacu.accounting.outlets import short
            gap=short(session,item.item_id,item.quantity)
            if gap and gap[0]<on_hand:on_hand=gap[0]
            else:gap=None
            if on_hand<item.quantity:
                # BR-022: only when the owner allows overselling, and never for adopted valuations. Stock stops at zero;
                # only the units on hand are costed; the rest is listed for review before period close (RSK-027).
                adopted=raw(session,'SELECT 1 FROM accounting.inventory_valuation WHERE business_id=%s AND item_id=%s',(tenant,str(item.item_id))).first()
                if not allow_shortfall or adopted or command.kind!='pos':
                    if gap:raise HTTPException(409,f'Only {gap[0]} x {row.name} at {gap[1]}. Transfer more there, or sell from the outlet that has it.')
                    raise HTTPException(409,'Stock or authoritative cost unavailable')
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
    raw(session,'INSERT INTO accounting.document_map(business_id,source_type,source_id,transaction_id) VALUES(%s,%s,%s,%s)',(tenant,DOCUMENT_TYPES.get(command.kind,command.kind),str(command.source_id),tx.id))
    result={'source_id':str(command.source_id),'transaction_id':tx.id,'transaction_no':tx.transaction_no,
            'amount':format(amount,'.2f'),'supporting_transaction_ids':secondary_transactions,'outstanding':format(target.amount-target.cleared(session),'.2f') if target else None}
    if command.payment_method:
        result.update(payment_method=command.payment_method,collection_account_id=str(command.main_account_id if command.kind=='pos' else command.lines[0].account_id))
    raw(session,'INSERT INTO accounting.posting_requests(business_id,request_key,payload_hash,result,created_by) VALUES(%s,%s,%s,%s::jsonb,%s)',
        (tenant,str(command.request_key),digest,json.dumps(result),str(actor)))
    raw(session,'INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,%s,%s::jsonb)',
        (tenant,str(actor),str(command.request_key),command.kind,json.dumps(result)))
    return result
