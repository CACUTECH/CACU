"""Stock adjustments with approval (FR-080, BR-021, PR-20).

A request is checked and valued when made. Owners and admins post directly up to the business's threshold;
anything above it, and every editor request, waits for an Owner or Admin. With separation of duties on (the
default) nobody approves their own request. Approval posts the movement through management_write, with the
request id as the movement id, and then the ledger entry: inventory against stock adjustments (5100).
"""
from datetime import date,datetime,time
from decimal import Decimal
import json
from uuid import UUID
from fastapi import HTTPException
from pydantic import BaseModel,ConfigDict,Field
from python_accounting.models import ReportingPeriod
from cacu.accounting.posting import PostingCommand,post_command,raw
from cacu.accounting.workflows import business_today,durable,purpose,role

class AdjustmentRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_key:UUID
    item_id:UUID
    expected_version:int=Field(ge=1)
    delta:int=Field(ge=-1000000,le=1000000)
    reason:str=Field(min_length=1,max_length=500)
    entry_date:date

class Decision(BaseModel):
    model_config=ConfigDict(extra='forbid')
    note:str=Field(default='',max_length=500)

class Policy(BaseModel):
    model_config=ConfigDict(extra='forbid')
    stock_threshold:str|None=Field(default=None,pattern=r'^[0-9]{1,13}(\.[0-9]{1,2})?$')
    separation_of_duties:bool=True

COLUMNS='id,item_id,delta,reason,entry_date,unit_cost,value,status,requested_by,requested_at,decided_by,decided_at,decision_note'

def _row(r):
    return {'id':str(r.id),'item_id':str(r.item_id),'delta':r.delta,'reason':r.reason,'entry_date':r.entry_date.isoformat(),
            'unit_cost':format(r.unit_cost,'.2f'),'value':format(r.value,'.2f'),'status':r.status,'requested_by':str(r.requested_by),
            'requested_at':r.requested_at.isoformat(),'decided_by':str(r.decided_by) if r.decided_by else None,
            'decided_at':r.decided_at.isoformat() if r.decided_at else None,'decision_note':r.decision_note}

def policy(session):
    row=raw(session,'SELECT stock_threshold,separation_of_duties FROM accounting.approval_policy WHERE business_id=%s',(str(session.business_id),)).first()
    if not row:return {'stock_threshold':None,'separation_of_duties':True}
    return {'stock_threshold':format(row.stock_threshold,'.2f') if row.stock_threshold is not None else None,'separation_of_duties':row.separation_of_duties}

def set_policy(session,actor,data:Policy):
    if role(session,actor)!='owner':raise HTTPException(403,'Only the Owner can change approval rules')
    tenant=str(session.business_id)
    raw(session,"""INSERT INTO accounting.approval_policy(business_id,stock_threshold,separation_of_duties,updated_by) VALUES(%s,%s,%s,%s)
      ON CONFLICT(business_id) DO UPDATE SET stock_threshold=EXCLUDED.stock_threshold,separation_of_duties=EXCLUDED.separation_of_duties,
      updated_by=EXCLUDED.updated_by,updated_at=now()""",(tenant,data.stock_threshold,data.separation_of_duties,str(actor)))
    result=policy(session)
    raw(session,'INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,gen_random_uuid(),%s,%s::jsonb)',
        (tenant,str(actor),'approval_policy',json.dumps(result)))
    return result

def _item(session,item_id):
    row=raw(session,"""SELECT name,version,stock_quantity,cost_price,item_type,track_stock,is_active FROM public.catalog_items
      WHERE id=%s AND business_id=%s FOR UPDATE""",(str(item_id),str(session.business_id))).first()
    if not row or row.item_type!='PRODUCT' or not row.track_stock or not row.is_active:raise HTTPException(409,'Choose an active product whose stock is tracked')
    return row

def _check(session,item,delta,entry_date):
    if (item.stock_quantity or 0)+delta<0:raise HTTPException(409,f'Only {item.stock_quantity or 0} in stock; the change would make it negative')
    cutover=raw(session,'SELECT cutover_date FROM accounting.business_map WHERE business_id=%s',(str(session.business_id),)).scalar()
    if entry_date<cutover or entry_date>business_today(session):raise HTTPException(409,'Stock date must be between the books start date and today')
    period=ReportingPeriod.get_period(session,datetime.combine(entry_date,time(12)))
    if period.status==ReportingPeriod.Status.CLOSED:raise HTTPException(409,'Stock changes cannot use a closed accounting period')
    cost=item.cost_price or Decimal('0')
    value=abs(delta)*cost
    if value!=value.quantize(Decimal('0.01')):raise HTTPException(409,'Stock valuation requires a reviewed two-decimal unit cost')
    return cost,value

def post_movement(session,actor,movement_id,offset):
    """Ledger entry and stock event for a movement management_write has just recorded."""
    tenant=str(session.business_id)
    movement=raw(session,'SELECT item_id,delta,unit_cost,entry_date,reason FROM public.inventory_movements WHERE business_id=%s AND id=%s',(tenant,str(movement_id))).one()
    value=abs(movement.delta)*movement.unit_cost
    posted=None
    if value:
        inventory=purpose(session,'inventory')
        posted=post_command(session,actor,PostingCommand(request_key=movement_id,kind='adjustment',source_id=movement_id,
            main_account_id=inventory,entry_date=movement.entry_date,narration=movement.reason,
            credited=movement.delta<0,lines=[{'account_id':offset,'amount':format(value,'.2f'),'credited':movement.delta>0}]))
    raw(session,'INSERT INTO accounting.stock_event(business_id,source_id,item_id,quantity,unit_cost) VALUES(%s,%s,%s,%s,%s)',
        (tenant,str(movement_id),str(movement.item_id),movement.delta,movement.unit_cost))
    return posted

def adjustment_offset(session):
    # PR-20 posts to inventory adjustments and write-offs (5100). Entities provisioned before the default
    # chart have no such purpose and keep their reviewed cost of sales mapping.
    has=raw(session,"SELECT count(*) FROM accounting.account_map WHERE business_id=%s AND purpose='stock_adjustment'",(str(session.business_id),)).scalar()
    return purpose(session,'stock_adjustment' if has else 'cogs')

def _post(session,actor,adjustment_id,note):
    tenant=str(session.business_id)
    row=raw(session,f'SELECT {COLUMNS} FROM accounting.stock_adjustment WHERE business_id=%s AND id=%s FOR UPDATE',(tenant,str(adjustment_id))).one()
    item=_item(session,row.item_id)
    cost,value=_check(session,item,row.delta,row.entry_date)
    if cost!=row.unit_cost:raise HTTPException(409,'The item cost changed after this request; reject it and ask for a new one')
    result=raw(session,'SELECT public.management_write(%s,%s,%s,%s,%s,%s::jsonb)',(tenant,str(row.id),'stock.adjust',str(row.item_id),item.version,
        json.dumps({'delta':row.delta,'reason':row.reason,'entry_date':row.entry_date.isoformat()}))).scalar()
    posting=post_movement(session,actor,row.id,adjustment_offset(session))
    raw(session,"UPDATE accounting.stock_adjustment SET status='posted',decided_by=%s,decided_at=now(),decision_note=%s WHERE business_id=%s AND id=%s",
        (str(actor),note or None,tenant,str(row.id)))
    return result,posting

def _read(session,adjustment_id):
    row=raw(session,f'SELECT {COLUMNS} FROM accounting.stock_adjustment WHERE business_id=%s AND id=%s',(str(session.business_id),str(adjustment_id))).one()
    return _row(row)

def request_adjustment(session,actor,data:AdjustmentRequest):
    entry_date=data.entry_date
    def execute():
        member=role(session,actor)
        if member not in {'owner','admin','editor'}:raise HTTPException(403,'Business permission required')
        if data.delta==0:raise HTTPException(422,'Enter a quantity change other than zero')
        if not data.reason.strip():raise HTTPException(422,'Give a reason for the stock change')
        item=_item(session,data.item_id)
        if item.version!=data.expected_version:raise HTTPException(409,'Item changed. Refresh before adjusting stock.')
        cost,value=_check(session,item,data.delta,entry_date)
        tenant=str(session.business_id)
        raw(session,'INSERT INTO accounting.stock_adjustment(business_id,id,item_id,delta,reason,entry_date,unit_cost,value,requested_by) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)',
            (tenant,str(data.request_key),str(data.item_id),data.delta,data.reason.strip(),entry_date,cost,value,str(actor)))
        rule=policy(session)
        direct=member in {'owner','admin'} and (rule['stock_threshold'] is None or value<=Decimal(rule['stock_threshold']))
        result={'item':None,'posting':None}
        if direct:
            result['item'],result['posting']=_post(session,actor,data.request_key,'Within the approval limit')
        raw(session,'INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,%s,%s::jsonb)',
            (tenant,str(actor),str(data.request_key),'stock_adjustment_requested',json.dumps({'item_id':str(data.item_id),'delta':data.delta,'value':format(value,'.2f'),'direct':direct})))
        return {'adjustment':_read(session,data.request_key),**result}
    return durable(session,actor,'stock_adjustment',data,execute)

def decide(session,actor,adjustment_id:UUID,approve:bool,data:Decision):
    tenant=str(session.business_id)
    member=role(session,actor)
    row=raw(session,'SELECT status,requested_by FROM accounting.stock_adjustment WHERE business_id=%s AND id=%s FOR UPDATE',(tenant,str(adjustment_id))).first()
    if not row:raise HTTPException(404,'Stock adjustment not found')
    own=str(row.requested_by)==str(actor)
    # The requester may withdraw their own request; deciding anyone else's needs an Owner or Admin.
    if member not in {'owner','admin'} and not(own and not approve):raise HTTPException(403,'Only an Owner or Admin can decide stock adjustments')
    if row.status!='pending':raise HTTPException(409,f'This adjustment was already {row.status}')
    if approve and own and policy(session)['separation_of_duties']:raise HTTPException(403,'Someone other than the requester must approve this adjustment')
    if not approve and not data.note.strip() and not own:raise HTTPException(422,'Say why the adjustment is rejected')
    result={'item':None,'posting':None}
    if approve:
        result['item'],result['posting']=_post(session,actor,adjustment_id,data.note.strip())
    else:
        raw(session,"UPDATE accounting.stock_adjustment SET status='rejected',decided_by=%s,decided_at=now(),decision_note=%s WHERE business_id=%s AND id=%s",
            (str(actor),data.note.strip() or 'Withdrawn by the requester',tenant,str(adjustment_id)))
    raw(session,'INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,%s,%s::jsonb)',
        (tenant,str(actor),str(adjustment_id),'stock_adjustment_'+('approved' if approve else 'rejected'),json.dumps({'note':data.note.strip()})))
    return {'adjustment':_read(session,adjustment_id),**result}

def list_adjustments(session,status=None,limit=50,actor=None):
    if status not in {None,'pending','posted','rejected'}:raise HTTPException(422,'Unknown status')
    rows=raw(session,f"""SELECT {', '.join('s.'+c for c in COLUMNS.split(','))},c.name AS item_name FROM accounting.stock_adjustment s
      JOIN public.catalog_items c ON c.id=s.item_id AND c.business_id=s.business_id
      WHERE s.business_id=%s AND (%s::text IS NULL OR s.status=%s) ORDER BY s.requested_at DESC LIMIT %s""",
      (str(session.business_id),status,status,limit)).all()
    return [{**_row(r),'item_name':r.item_name,'mine':actor is not None and str(r.requested_by)==str(actor)} for r in rows]
