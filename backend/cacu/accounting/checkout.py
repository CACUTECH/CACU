"""POS checkout settings and receipts (Doc 10 checkout rules, BR-022)."""
from decimal import Decimal
from uuid import UUID
from fastapi import HTTPException
from pydantic import BaseModel,ConfigDict
from cacu.accounting.posting import raw
from cacu.accounting.workflows import role,sales_policy


class SalesPolicy(BaseModel):
    model_config=ConfigDict(extra='forbid')
    allow_oversell:bool


def options(session):
    """What the till needs before a sale: the member's discount limit and whether overselling is on."""
    cap=Decimal(raw(session,'SELECT authz.discount_cap(%s)',(str(session.business_id),)).scalar() or 0)
    from cacu.accounting.refunds import refund_policy
    from cacu.accounting.shifts import shift_policy
    return {'discount_cap':format(cap.normalize(),'f'),**sales_policy(session),**refund_policy(session),**shift_policy(session)}


def save_policy(session,actor,data:SalesPolicy):
    if role(session,actor)!='owner':raise HTTPException(403,'Only the business owner can change whether stock can be oversold')
    raw(session,"""INSERT INTO accounting.sales_policy(business_id,allow_oversell,updated_by) VALUES(%s,%s,%s)
      ON CONFLICT (business_id) DO UPDATE SET allow_oversell=EXCLUDED.allow_oversell,updated_by=EXCLUDED.updated_by,updated_at=now()""",
        (str(session.business_id),data.allow_oversell,str(actor)))
    raw(session,"INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,gen_random_uuid(),'sales_policy',jsonb_build_object('allow_oversell',%s))",
        (str(session.business_id),str(actor),data.allow_oversell))
    return sales_policy(session)


def shortfalls(session,include_reviewed=False):
    rows=raw(session,f"""SELECT f.sale_id,f.item_id,f.quantity,f.created_at,f.reviewed_at,c.name FROM accounting.stock_shortfall f
      JOIN public.catalog_items c ON c.id=f.item_id AND c.business_id=f.business_id
      WHERE f.business_id=%s {'' if include_reviewed else 'AND f.reviewed_at IS NULL'} ORDER BY f.created_at LIMIT 200""",(str(session.business_id),)).all()
    return [{'sale_id':str(r.sale_id),'item_id':str(r.item_id),'item':r.name,'quantity':r.quantity,'created_at':r.created_at.isoformat(),
             'reviewed':r.reviewed_at is not None} for r in rows]


def review_shortfall(session,actor,sale_id:UUID,item_id:UUID):
    """The owner or a stock approver has counted the item and corrected stock (for example by a stock adjustment)."""
    updated=raw(session,"""UPDATE accounting.stock_shortfall SET reviewed_by=%s,reviewed_at=now()
      WHERE business_id=%s AND sale_id=%s AND item_id=%s AND reviewed_at IS NULL RETURNING quantity""",(str(actor),str(session.business_id),str(sale_id),str(item_id))).first()
    if not updated:raise HTTPException(404,'No open shortfall for that sale and item')
    return {'sale_id':str(sale_id),'item_id':str(item_id),'reviewed':True}


def receipt(session,sale_id:UUID):
    """Doc 10 receipt (the screen adds the business name): sale number, items, amounts, payment method and, for a pending transfer, that it is
    awaiting confirmation."""
    tenant=str(session.business_id)
    sale=raw(session,"""SELECT s.id,s.status,s.payment_method,s.total,s.subtotal,s.discount_total,s.cash_received,s.change_given,s.transfer_amount,s.refunded_total,s.deposit_applied,
        t.transaction_no,t.transaction_date::date AS sold_on
      FROM public.transactions s JOIN accounting.document_map d ON d.business_id=s.business_id AND d.source_id=s.id AND d.source_type='pos'
      JOIN accounting."transaction" t ON t.id=d.transaction_id AND t.business_id=d.business_id
      WHERE s.business_id=%s AND s.id=%s""",(tenant,str(sale_id))).first()
    if not sale:raise HTTPException(404,'Sale not found')
    items=raw(session,"""SELECT description,quantity,unit_price,discount,line_total FROM public.transaction_items
      WHERE business_id=%s AND transaction_id=%s ORDER BY description""",(tenant,str(sale_id))).all()
    money=lambda v:format(v,'.2f') if v is not None else None
    return {'id':str(sale.id),'number':sale.transaction_no,'date':sale.sold_on.isoformat(),'status':sale.status,
            'method':sale.payment_method,'subtotal':money(sale.subtotal),'discount_total':money(sale.discount_total),'total':money(sale.total),
            'cash_received':money(sale.cash_received),'change':money(sale.change_given),'transfer_amount':money(sale.transfer_amount),'refunded_total':money(sale.refunded_total),
            'deposit_applied':money(sale.deposit_applied),'paid_now':money(sale.total-sale.deposit_applied),
            'items':[{'name':i.description,'quantity':int(i.quantity),'unit_price':money(i.unit_price),'discount':money(i.discount),'total':money(i.line_total)} for i in items]}
