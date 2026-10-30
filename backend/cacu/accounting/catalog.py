"""Catalog stock mutations share the existing native accounting transaction."""
from datetime import datetime,time
from zoneinfo import ZoneInfo
from decimal import Decimal
import json
from typing import Literal
from uuid import UUID
from fastapi import HTTPException
from python_accounting.models import ReportingPeriod
from pydantic import BaseModel,ConfigDict,Field
from cacu.accounting.posting import raw
from cacu.accounting.workflows import durable,purpose
from cacu.accounting.stock import AdjustmentRequest,post_movement,request_adjustment

class CatalogMutation(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_key:UUID
    operation:Literal['item.save','stock.adjust']
    item_id:UUID|None=None
    expected_version:int|None=Field(default=None,ge=1)
    details:dict

def catalog_mutate(session,actor,data:CatalogMutation):
    role=raw(session,'SELECT accounting.lock_membership(%s,%s)',(str(session.business_id),str(actor))).scalar()
    if data.operation=='stock.adjust':
        # Same rules as the stock adjustments endpoint, so the approval limit cannot be bypassed from here.
        try:request=AdjustmentRequest(request_key=data.request_key,item_id=data.item_id,expected_version=data.expected_version,**data.details)
        except (TypeError,ValueError):raise HTTPException(409,'Check the quantity, reason, date and available stock.') from None
        result=request_adjustment(session,actor,request)
        return {**(result['item'] or {}),'adjustment':result['adjustment'],'posting':result['posting']}
    if role not in {'owner','admin'} and not(role=='editor' and data.item_id is None):
        raise HTTPException(403,'Owner or administrator permission required')
    def execute():
        result=raw(session,'SELECT public.management_write(%s,%s,%s,%s,%s,%s::jsonb)',
            (str(session.business_id),str(data.request_key),data.operation,str(data.item_id) if data.item_id else None,data.expected_version,json.dumps(data.details))).scalar()
        if result.get('movement_id'):
            # Opening stock on a new item, offset to opening balance equity.
            movement=raw(session,'SELECT delta,unit_cost,entry_date FROM public.inventory_movements WHERE business_id=%s AND id=%s',
                (str(session.business_id),str(data.request_key))).one()
            cutover=raw(session,'SELECT cutover_date FROM accounting.business_map WHERE business_id=%s',(str(session.business_id),)).scalar()
            if movement.entry_date<cutover or movement.entry_date>datetime.now(ZoneInfo(session.business_timezone)).date():raise HTTPException(409,'Stock date must be within the current accounting cutover')
            period=ReportingPeriod.get_period(session,datetime.combine(movement.entry_date,time(12)))
            if period.status==ReportingPeriod.Status.CLOSED:raise HTTPException(409,'Stock changes cannot use a closed accounting period')
            value=abs(movement.delta)*movement.unit_cost
            if value!=value.quantize(Decimal('0.01')):raise HTTPException(409,'Stock valuation requires a reviewed two-decimal unit cost')
            posted=post_movement(session,actor,data.request_key,purpose(session,'equity'))
            if posted:result['posting']=posted
        return result
    return durable(session,actor,'catalog:'+str(actor),data,execute)
