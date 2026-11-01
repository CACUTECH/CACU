"""IAS 2 moving weighted-average stock, exact cent residuals and separate NRV allowance.

Opt-in adoption never reposts opening stock. All writes share library_transaction's tenant lock.
Historical dates cannot be inserted behind a valuation event; use a reviewed correction instead.
"""
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
import json
from typing import Literal
from uuid import UUID, uuid5
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from cacu.accounting.posting import raw, account, PostingCommand, post_command
from cacu.accounting.workflows import role, durable, purpose, business_today, party_account, collection_account

AMOUNT = r'^[0-9]{1,13}(\.[0-9]{1,2})?$'
ZERO = Decimal('0')
CENT = Decimal('.01')

def cents(value): return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)
def proportion(total, quantity, available):
    if available <= 0 or quantity <= 0 or quantity > available:
        raise HTTPException(409, 'Quantity exceeds available valuation units')
    return total if quantity == available else cents(total * quantity / available)

class Command(BaseModel):
    model_config = ConfigDict(extra='forbid',str_strip_whitespace=True)
    request_key: UUID

class InventoryPolicy(Command):
    formula: Literal['moving_weighted_average']
    allowance_account_id: UUID
    evidence: str = Field(min_length=10, max_length=2000)

class AdoptItem(Command):
    item_id: UUID
    expected_version: int = Field(ge=1)
    entry_date: date
    evidence: str = Field(min_length=10, max_length=2000)

class ReceiptLine(BaseModel):
    model_config = ConfigDict(extra='forbid',str_strip_whitespace=True)
    item_id: UUID
    quantity: int = Field(gt=0,le=1000000)
    purchase_cost: str = Field(pattern=AMOUNT)
    rebate: str = Field(default='0.00',pattern=AMOUNT)
    landed_cost: str = Field(default='0.00',pattern=AMOUNT)
    nonrecoverable_tax: str = Field(default='0.00',pattern=AMOUNT)
    recoverable_tax: str = Field(default='0.00',pattern=AMOUNT)

class GoodsReceipt(Command):
    supplier_id: UUID
    bill_number: str = Field(min_length=1,max_length=100)
    entry_date: date
    lines: list[ReceiptLine] = Field(min_length=1,max_length=40)
    tax_account_id: UUID | None = None
    evidence: str = Field(min_length=10,max_length=2000)

class NrvAssessment(Command):
    item_id: UUID
    entry_date: date
    estimated_selling_total: str = Field(pattern=AMOUNT)
    completion_and_selling_costs: str = Field(pattern=AMOUNT)
    evidence: str = Field(min_length=10,max_length=2000)

class StockReturn(Command):
    refund_method:Literal['Cash','Transfer']|None=None
    bank_account_id:UUID|None=None
    original_source_id: UUID
    item_id: UUID
    quantity: int = Field(gt=0,le=1000000)
    entry_date: date
    evidence: str = Field(min_length=10,max_length=2000)


def writer(session,actor):
    if role(session,actor) not in {'owner','admin'}:
        raise HTTPException(403, 'Owner or Admin permission required for valuation controls')


def policy(session):
    return raw(session,'SELECT * FROM accounting.inventory_policy WHERE business_id=%s',(str(session.business_id),)).first()


def set_policy(session,actor,data: InventoryPolicy):
    def execute():
        writer(session,actor)
        acc=account(session,data.allowance_account_id)
        mapping=raw(session,'SELECT flow_section,purpose FROM accounting.account_map WHERE business_id=%s AND account_id=%s',(str(session.business_id),str(data.allowance_account_id))).one()
        if acc.account_type.name!='CURRENT_ASSET' or mapping.flow_section!='operating':
            raise HTTPException(422,'Use a dedicated operating current-asset contra account for the inventory allowance')
        if raw(session,'SELECT 1 FROM accounting.ledger WHERE business_id=%s AND post_account_id=%s LIMIT 1',(str(session.business_id),acc.id)).first():
            raise HTTPException(409,'The NRV allowance account must be a dedicated unused account; preserve existing account history')
        if policy(session): raise HTTPException(409,'Inventory formula already adopted; policy changes need a reviewed migration')
        raw(session,'INSERT INTO accounting.inventory_policy(business_id,formula,allowance_account_id,evidence,approved_by) VALUES(%s,%s,%s,%s,%s)',
            (str(session.business_id),data.formula,str(data.allowance_account_id),data.evidence,str(actor)))
        return {'formula':data.formula,'approved_by':str(actor)}
    return durable(session,actor,'inventory_policy',data,execute)


def state(session,item_id):
    return raw(session,'SELECT * FROM accounting.inventory_valuation WHERE business_id=%s AND item_id=%s FOR UPDATE',(str(session.business_id),str(item_id))).first()


def dated(session,entry_date,valuation=None):
    cutover=raw(session,'SELECT cutover_date FROM accounting.business_map WHERE business_id=%s',(str(session.business_id),)).scalar()
    if entry_date<cutover or entry_date>business_today(session):
        raise HTTPException(409,'Valuation date must be between cutover and today')
    if valuation and entry_date<valuation.last_date:
        raise HTTPException(409,'Valuation predates a later stock event; use a reviewed current-period correction')
    from datetime import datetime,time
    from python_accounting.models import ReportingPeriod
    period=ReportingPeriod.get_period(session,datetime.combine(entry_date,time(12)))
    if period.status==ReportingPeriod.Status.CLOSED: raise HTTPException(409,'Valuation cannot use a closed period')


def item(session,item_id):
    r=raw(session,"SELECT * FROM public.catalog_items WHERE business_id=%s AND id=%s AND is_active AND item_type='PRODUCT' AND track_stock FOR UPDATE",(str(session.business_id),str(item_id))).first()
    if not r: raise HTTPException(422,'Active tracked product required')
    return r


def event(session,actor,key,item_id,kind,day,qty,gross,allowance,source,evidence,origin=None):
    raw(session,"""INSERT INTO accounting.inventory_value_event
      (business_id,id,item_id,kind,entry_date,quantity,gross_change,allowance_change,source_id,origin_id,evidence,actor_id)
      VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s)""",
      (str(session.business_id),str(key),str(item_id),kind,day,qty,gross,allowance,str(source),str(origin) if origin else None,json.dumps(evidence),str(actor)))


def update(session,item_id,qty,gross,allowance,day):
    raw(session,'UPDATE accounting.inventory_valuation SET quantity=%s,gross_cost=%s,allowance=%s,last_date=%s,version=version+1 WHERE business_id=%s AND item_id=%s',
        (qty,gross,allowance,day,str(session.business_id),str(item_id)))
    unit=(gross/qty).quantize(Decimal('.0001'),rounding=ROUND_HALF_UP) if qty else ZERO
    raw(session,'UPDATE public.catalog_items SET cost_price=%s,version=version+1 WHERE business_id=%s AND id=%s',(unit,str(session.business_id),str(item_id)))


def adopt(session,actor,data:AdoptItem):
    def execute():
        writer(session,actor)
        if not policy(session): raise HTTPException(409,'Approve the costing policy first')
        r=item(session,data.item_id);dated(session,data.entry_date)
        if data.entry_date!=business_today(session):raise HTTPException(409,'Adopt the reconciled current stock position using today as the valuation start date')
        if r.version!=data.expected_version:raise HTTPException(409,'Item changed; refresh before adopting valuation')
        if state(session,data.item_id):raise HTTPException(409,'Item valuation already adopted')
        qty=r.stock_quantity or 0;gross=qty*(r.cost_price or ZERO)
        if qty<0 or gross<0 or gross!=cents(gross):raise HTTPException(409,'Reconcile legacy quantity and cost to exact cents before adoption')
        raw(session,'INSERT INTO accounting.inventory_valuation(business_id,item_id,quantity,gross_cost,last_date) VALUES(%s,%s,%s,%s,%s)',
            (str(session.business_id),str(data.item_id),qty,gross,data.entry_date))
        event(session,actor,data.request_key,data.item_id,'adoption',data.entry_date,qty,gross,ZERO,data.request_key,{'review':data.evidence,'no_ledger_posting':True})
        return {'item_id':str(data.item_id),'quantity':qty,'gross_cost':format(gross,'.2f')}
    return durable(session,actor,'inventory_adoption',data,execute)


def consume(session,actor,source,item_id,qty,day):
    v=state(session,item_id)
    if not v:return None  # legacy workflow retained until explicit adoption
    dated(session,day,v)
    r=item(session,item_id)
    if r.stock_quantity!=v.quantity:raise HTTPException(409,'Stock quantities do not reconcile to valuation')
    gross=proportion(v.gross_cost,qty,v.quantity);allowance=proportion(v.allowance,qty,v.quantity)
    update(session,item_id,v.quantity-qty,v.gross_cost-gross,v.allowance-allowance,day)
    event(session,actor,uuid5(source,str(item_id)),item_id,'issue',day,-qty,-gross,-allowance,source,{})
    return gross,allowance


def allowance_post(session,actor,key,day,change,narration):
    if not change:return None
    p=policy(session)
    if not p:raise HTTPException(409,'Reviewed allowance account required')
    from cacu.accounting.stock import adjustment_offset
    offset=adjustment_offset(session) if 'NRV' in narration or 'adjustment' in narration else purpose(session,'cogs')
    result=post_command(session,actor,PostingCommand(request_key=key,kind='adjustment',source_id=key,
        main_account_id=p.allowance_account_id,entry_date=day,narration=narration,credited=change>0,
        lines=[{'account_id':offset,'amount':format(abs(change),'.2f'),'credited':change<0}]),managed_stock=True)
    raw(session,'INSERT INTO accounting.inventory_journal(business_id,source_id) VALUES(%s,%s)',(str(session.business_id),str(key)))
    return result


def receipt(session,actor,data:GoodsReceipt):
    def execute():
        writer(session,actor)
        if not policy(session):raise HTTPException(409,'Approve the costing policy first')
        if len({l.item_id for l in data.lines})!=len(data.lines):raise HTTPException(422,'Duplicate receipt item')
        number=data.bill_number.strip()
        if not number:raise HTTPException(422,'Supplier bill number required')
        tenant=str(session.business_id)
        if raw(session,'SELECT 1 FROM accounting.supplier_bill WHERE business_id=%s AND supplier_id=%s AND lower(btrim(bill_number))=lower(%s)',(tenant,str(data.supplier_id),number)).first():
            raise HTTPException(409,'Supplier bill already recorded; do not receive it twice')
        payable=party_account(session,'suppliers',data.supplier_id)
        total=tax=ZERO;costs=[]
        for line in sorted(data.lines,key=lambda l:str(l.item_id)):
            r=item(session,line.item_id);v=state(session,line.item_id)
            if not v:raise HTTPException(409,'Adopt each receipt item before using weighted-average costing')
            dated(session,data.entry_date,v)
            if r.stock_quantity!=v.quantity:raise HTTPException(409,'Quantity and valuation differ')
            cost=Decimal(line.purchase_cost)-Decimal(line.rebate)+Decimal(line.landed_cost)+Decimal(line.nonrecoverable_tax)
            if cost<=0:raise HTTPException(422,'Eligible receipt cost after rebates must be positive')
            total+=cost;tax+=Decimal(line.recoverable_tax);costs.append((line,v,cost))
        lines=[{'account_id':purpose(session,'inventory'),'amount':format(total,'.2f')}]
        if tax:
            if not data.tax_account_id:raise HTTPException(422,'Reviewed recoverable-tax account required')
            a=account(session,data.tax_account_id)
            section=raw(session,'SELECT flow_section FROM accounting.account_map WHERE business_id=%s AND account_id=%s',(tenant,str(data.tax_account_id))).scalar()
            if a.account_type.name!='CURRENT_ASSET' or section!='operating' or str(data.tax_account_id)==str(policy(session).allowance_account_id):
                raise HTTPException(422,'Separate operating current-asset account required for recoverable tax')
            lines.append({'account_id':data.tax_account_id,'amount':format(tax,'.2f')})
        raw(session,'INSERT INTO accounting.supplier_bill(business_id,id,supplier_id,bill_number,bill_date,notes,created_by) VALUES(%s,%s,%s,%s,%s,%s,%s)',
            (tenant,str(data.request_key),str(data.supplier_id),number,data.entry_date,data.evidence,str(actor)))
        posted=post_command(session,actor,PostingCommand(request_key=uuid5(data.request_key,'bill'),kind='bill',source_id=data.request_key,
            main_account_id=payable,counterparty_id=data.supplier_id,entry_date=data.entry_date,narration='Goods receipt '+number,lines=lines),managed_stock=True)
        for line,v,cost in costs:
            update(session,line.item_id,v.quantity+line.quantity,v.gross_cost+cost,v.allowance,data.entry_date)
            raw(session,'UPDATE public.catalog_items SET stock_quantity=stock_quantity+%s WHERE business_id=%s AND id=%s',(line.quantity,tenant,str(line.item_id)))
            event(session,actor,uuid5(data.request_key,str(line.item_id)),line.item_id,'receipt',data.entry_date,line.quantity,cost,ZERO,data.request_key,{'costs':line.model_dump(mode='json'),'bill':number,'review':data.evidence})
            raw(session,'INSERT INTO accounting.stock_event(business_id,source_id,item_id,quantity,unit_cost) VALUES(%s,%s,%s,%s,%s)',(tenant,str(data.request_key),str(line.item_id),line.quantity,(cost/line.quantity).quantize(Decimal('.0001'))))
        return {'id':str(data.request_key),'inventory_cost':format(total,'.2f'),'recoverable_tax':format(tax,'.2f'),'posting':posted}
    return durable(session,actor,'goods_receipt',data,execute)


def assess_nrv(session,actor,data:NrvAssessment):
    def execute():
        writer(session,actor);r=item(session,data.item_id);v=state(session,data.item_id)
        if not v:raise HTTPException(409,'Adopt valuation first')
        dated(session,data.entry_date,v)
        if r.stock_quantity!=v.quantity:raise HTTPException(409,'Quantity and valuation differ')
        nrv=max(ZERO,Decimal(data.estimated_selling_total)-Decimal(data.completion_and_selling_costs))
        allowance=max(ZERO,v.gross_cost-nrv);change=allowance-v.allowance
        posted=allowance_post(session,actor,uuid5(data.request_key,'nrv'),data.entry_date,change,'NRV inventory valuation')
        update(session,data.item_id,v.quantity,v.gross_cost,allowance,data.entry_date)
        event(session,actor,data.request_key,data.item_id,'nrv',data.entry_date,0,ZERO,change,data.request_key,data.model_dump(mode='json'))
        return {'id':str(data.request_key),'gross_cost':format(v.gross_cost,'.2f'),'allowance':format(allowance,'.2f'),'carrying_amount':format(v.gross_cost-allowance,'.2f'),'posting':posted}
    return durable(session,actor,'inventory_nrv',data,execute)


def restore_return(session,actor,data:StockReturn):
    def execute():
        writer(session,actor);r=item(session,data.item_id);v=state(session,data.item_id)
        if not v:raise HTTPException(409,'Adopt valuation first')
        dated(session,data.entry_date,v)
        if r.stock_quantity!=v.quantity:raise HTTPException(409,'Stock quantities do not reconcile to valuation')
        origin=raw(session,"SELECT * FROM accounting.inventory_value_event WHERE business_id=%s AND source_id=%s AND item_id=%s AND kind='issue'",(str(session.business_id),str(data.original_source_id),str(data.item_id))).first()
        if not origin or data.entry_date<origin.entry_date:raise HTTPException(409,'Original valued fulfillment required')
        returned=raw(session,"SELECT coalesce(sum(quantity),0),coalesce(sum(gross_change),0),coalesce(sum(allowance_change),0) FROM accounting.inventory_value_event WHERE business_id=%s AND origin_id=%s AND kind='return'",(str(session.business_id),str(origin.id))).one()
        gross=proportion(-origin.gross_change-returned[1],data.quantity,-origin.quantity-returned[0])
        allowance=proportion(-origin.allowance_change-returned[2],data.quantity,-origin.quantity-returned[0])
        invoice=raw(session,"""SELECT i.customer_id,ii.unit_price FROM public.invoices i JOIN public.invoice_items ii ON ii.invoice_id=i.id AND ii.business_id=i.business_id
          JOIN accounting.document_map d ON d.source_id=i.id AND d.business_id=i.business_id AND d.source_type='invoice'
          WHERE i.business_id=%s AND i.id=%s AND ii.catalog_item_id=%s""",(str(session.business_id),str(data.original_source_id),str(data.item_id))).first()
        price=invoice.unit_price if invoice else None
        if price is None:
            price=raw(session,"""SELECT i.unit_price FROM public.transaction_items i JOIN accounting.document_map d
              ON d.source_id=i.transaction_id AND d.business_id=i.business_id AND d.source_type='pos'
              WHERE i.business_id=%s AND i.transaction_id=%s AND i.catalog_item_id=%s""",
              (str(session.business_id),str(data.original_source_id),str(data.item_id))).scalar()
        if price is None:raise HTTPException(409,'Original posted sale and price required')
        amount=cents(price*data.quantity);credit=None;credited=ZERO
        if invoice:
            from python_accounting.models import Transaction
            target_id=raw(session,"SELECT transaction_id FROM accounting.document_map WHERE business_id=%s AND source_id=%s AND source_type='invoice'",(str(session.business_id),str(data.original_source_id))).scalar()
            target=session.get(Transaction,target_id)
            credited=min(amount,target.amount-target.cleared(session))
            if credited>ZERO:
                credit=post_command(session,actor,PostingCommand(request_key=uuid5(data.request_key,'credit'),source_id=data.request_key,kind='credit_note',target_id=data.original_source_id,
                    main_account_id=party_account(session,'customers',invoice.customer_id),counterparty_id=invoice.customer_id,entry_date=data.entry_date,narration='Customer return: '+data.evidence,
                    lines=[{'account_id':purpose(session,'revenue'),'amount':format(credited,'.2f')}]))
        refund=amount-credited;refund_posting=None
        if refund:
            if data.refund_method is None:raise HTTPException(409,'This paid sale requires an explicit cash or bank refund method')
            paid_from=collection_account(session,data.refund_method,data.bank_account_id)
            key=uuid5(data.request_key,'refund')
            refund_posting=post_command(session,actor,PostingCommand(request_key=key,source_id=key,kind='adjustment',main_account_id=paid_from,
                entry_date=data.entry_date,narration='Refund for '+str(data.original_source_id)+': '+data.evidence,credited=True,
                lines=[{'account_id':purpose(session,'revenue'),'amount':format(refund,'.2f'),'credited':False}]))
            raw(session,'INSERT INTO accounting.inventory_journal(business_id,source_id) VALUES(%s,%s)',(str(session.business_id),str(key)))
        if gross:
            key=uuid5(data.request_key,'stock')
            post_command(session,actor,PostingCommand(request_key=key,source_id=key,kind='adjustment',main_account_id=purpose(session,'inventory'),entry_date=data.entry_date,narration='Return of fulfilled inventory',credited=False,
                lines=[{'account_id':purpose(session,'cogs'),'amount':format(gross,'.2f'),'credited':True}]),managed_stock=True)
        raw(session,'INSERT INTO accounting.inventory_journal(business_id,source_id) VALUES(%s,%s)',(str(session.business_id),str(uuid5(data.request_key,'stock'))))
        allowance_post(session,actor,uuid5(data.request_key,'allowance'),data.entry_date,allowance,'Return of inventory allowance')
        update(session,data.item_id,v.quantity+data.quantity,v.gross_cost+gross,v.allowance+allowance,data.entry_date)
        raw(session,'UPDATE public.catalog_items SET stock_quantity=stock_quantity+%s WHERE business_id=%s AND id=%s',(data.quantity,str(session.business_id),str(data.item_id)))
        event(session,actor,data.request_key,data.item_id,'return',data.entry_date,data.quantity,gross,allowance,data.request_key,{'review':data.evidence,'original_sale':str(data.original_source_id),'credit_amount':format(credited,'.2f'),'refund_amount':format(refund,'.2f'),'refund_method':data.refund_method,'refund_posting':refund_posting},origin.id)
        raw(session,'INSERT INTO accounting.stock_event(business_id,source_id,item_id,quantity,unit_cost) VALUES(%s,%s,%s,%s,%s)',(str(session.business_id),str(data.request_key),str(data.item_id),data.quantity,(gross/data.quantity).quantize(Decimal('.0001'))))
        return {'id':str(data.request_key),'credit':credit,'refund':refund_posting,'refund_amount':format(refund,'.2f'),'gross_restored':format(gross,'.2f')}
    return durable(session,actor,'inventory_return',data,execute)


def movement_value(session,actor,source,item_id,delta,day):
    v=state(session,item_id)
    if not v:return None
    dated(session,day,v)
    r=item(session,item_id)
    if r.stock_quantity!=v.quantity+delta:raise HTTPException(409,'Stock movement differs from valuation')
    if delta<0:
        gross=-proportion(v.gross_cost,-delta,v.quantity);allowance=-proportion(v.allowance,-delta,v.quantity)
    else:
        if not v.quantity:raise HTTPException(409,'Receive stock with documented purchase cost before a quantity gain')
        gross=cents(v.gross_cost*delta/v.quantity);allowance=ZERO
    update(session,item_id,v.quantity+delta,v.gross_cost+gross,v.allowance+allowance,day)
    event(session,actor,source,item_id,'adjustment',day,delta,gross,allowance,source,{})
    allowance_post(session,actor,uuid5(source,'allowance'),day,allowance,'Quantity adjustment allowance')
    return abs(gross)


def overview(session):
    rows=raw(session,"""SELECT c.id,c.name,c.version,c.stock_quantity,c.cost_price,v.quantity,v.gross_cost,v.allowance,(v.gross_cost-v.allowance) AS carrying_amount,v.last_date
      FROM public.catalog_items c LEFT JOIN accounting.inventory_valuation v ON v.business_id=c.business_id AND v.item_id=c.id
      WHERE c.business_id=%s AND c.item_type='PRODUCT' AND c.track_stock AND c.is_active ORDER BY c.name LIMIT 501""",(str(session.business_id),)).mappings().all()
    if len(rows)>500:raise HTTPException(409,'Refine the inventory listing before valuation review')
    p=policy(session)
    events=raw(session,'SELECT id,item_id,kind,entry_date,quantity,gross_change,allowance_change,source_id,evidence FROM accounting.inventory_value_event WHERE business_id=%s ORDER BY created_at DESC,id LIMIT 100',(str(session.business_id),)).mappings()
    def serial(row):return {k:format(v,'.2f') if isinstance(v,Decimal) else v.isoformat() if isinstance(v,date) else str(v) if isinstance(v,UUID) else v for k,v in dict(row).items()}
    return {'formula':p.formula if p else None,'allowance_account_id':str(p.allowance_account_id) if p else None,'items':[serial(r) for r in rows],'events':[serial(r) for r in events]}
