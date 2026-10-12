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
from cacu.accounting.posting import PostingCommand,post_command,raw
from cacu.accounting.workflows import durable,purpose

class CatalogMutation(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_key:UUID
    operation:Literal['item.save','stock.adjust']
    item_id:UUID|None=None
    expected_version:int|None=Field(default=None,ge=1)
    details:dict

def catalog_mutate(session,actor,data:CatalogMutation):
    role=raw(session,'SELECT accounting.lock_membership(%s,%s)',(str(session.business_id),str(actor))).scalar()
    if role not in {'owner','admin'} and not(role=='editor' and data.operation=='item.save' and data.item_id is None):
        raise HTTPException(403,'Owner or administrator permission required')
    def execute():
        result=raw(session,'SELECT public.management_write(%s,%s,%s,%s,%s,%s::jsonb)',
            (str(session.business_id),str(data.request_key),data.operation,str(data.item_id) if data.item_id else None,data.expected_version,json.dumps(data.details))).scalar()
        if result.get('movement_id'):
            movement=raw(session,'SELECT delta,unit_cost,entry_date,reason FROM public.inventory_movements WHERE business_id=%s AND id=%s',
                (str(session.business_id),str(data.request_key))).one()
            cutover=raw(session,'SELECT cutover_date FROM accounting.business_map WHERE business_id=%s',(str(session.business_id),)).scalar()
            if movement.entry_date<cutover or movement.entry_date>datetime.now(ZoneInfo(session.business_timezone)).date():raise HTTPException(409,'Stock date must be within the current accounting cutover')
            period=ReportingPeriod.get_period(session,datetime.combine(movement.entry_date,time(12)))
            if period.status==ReportingPeriod.Status.CLOSED:raise HTTPException(409,'Stock changes cannot use a closed accounting period')
            value=abs(movement.delta)*movement.unit_cost
            if value!=value.quantize(Decimal('0.01')):raise HTTPException(409,'Stock valuation requires a reviewed two-decimal unit cost')
            if value:
                inventory=purpose(session,'inventory')
                offset=purpose(session,'equity' if data.operation=='item.save' else 'cogs')
                posted=post_command(session,actor,PostingCommand(request_key=data.request_key,kind='adjustment',source_id=data.request_key,
                    main_account_id=inventory,entry_date=movement.entry_date,narration=movement.reason,
                    credited=movement.delta<0,lines=[{'account_id':offset,'amount':format(value,'.2f'),'credited':movement.delta>0}]))
                result['posting']=posted
            raw(session,'INSERT INTO accounting.stock_event(business_id,source_id,item_id,quantity,unit_cost) VALUES(%s,%s,%s,%s,%s)',
                (str(session.business_id),str(data.request_key),result['id'],movement.delta,movement.unit_cost))
        return result
    return durable(session,actor,'catalog:'+str(actor),data,execute)
