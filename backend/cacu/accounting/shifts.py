"""Cashier shifts (Doc 10 shifts, Doc 09 PR-22, Doc 11 /shifts), on the Oga and Chairman plans.

A cashier opens a shift with a counted float. Every sale they record, cash refund paid from their till, and pay-in or
pay-out while it is open is tagged to it in the shift's cash ledger, so expected cash is the float plus that ledger.
Pay-ins and pay-outs need a reason and post as an expense (PR-17) or a transfer between the till and a bank (PR-21).
Closing, the cashier counts the cash; any difference posts to Cash over and short (PR-22) and is shown to the owner on
Daily reconciliation. A shift still open after midnight business time is flagged. Each action is replay-safe under its
request key; a shift is closed once."""
from datetime import date
from decimal import Decimal
import json
from typing import Literal
from uuid import UUID,uuid5
from fastapi import HTTPException
from pydantic import BaseModel,ConfigDict,Field
from cacu.accounting.posting import PostingCommand,post_command,raw
from cacu.accounting.session import allowed
from cacu.accounting.workflows import business_today,collection_account,durable,expense_accounts,purpose,role

ZERO=Decimal('0')
AMOUNT=r'^[0-9]{1,13}(\.[0-9]{1,2})?$'
PLAN_MESSAGE='Cashier shifts come with the Oga and Chairman plans. Upgrade in Billing to use them.'


class ShiftOpen(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_key:UUID
    opening_float:str=Field(pattern=AMOUNT)
    location_id:UUID|None=None


class CashMovement(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_key:UUID
    kind:Literal['pay_in','pay_out']
    amount:str=Field(pattern=AMOUNT)
    reason:str=Field(min_length=3,max_length=500)
    expense_account_id:UUID|None=None
    bank_account_id:UUID|None=None


class ShiftClose(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_key:UUID
    counted_cash:str=Field(pattern=AMOUNT)
    note:str=Field(default='',max_length=500)


class ShiftPolicy(BaseModel):
    model_config=ConfigDict(extra='forbid')
    require_shift:bool


def available(session):
    return bool(raw(session,'SELECT accounting.shifts_allowed(%s)',(str(session.business_id),)).scalar())


def _require_plan(session):
    if not available(session):raise HTTPException(403,PLAN_MESSAGE)


def shift_policy(session):
    row=raw(session,'SELECT require_shift FROM accounting.sales_policy WHERE business_id=%s',(str(session.business_id),)).first()
    return {'require_shift':bool(row and row.require_shift)}


def open_shift(session,actor,lock=False):
    """The person's open shift, if any. Locked for share while a sale or refund is tagged to it, so it cannot close
    underneath them."""
    return raw(session,f"SELECT * FROM accounting.till_shift WHERE business_id=%s AND opened_by=%s AND status='open'{' FOR SHARE' if lock else ''}",
               (str(session.business_id),str(actor))).first()


def tag(session,people,kind,source_id,cash):
    """Adds a cash movement to the first open shift among people (the cashier first). Returns the shift id or None."""
    for person in people:
        if person is None:continue
        shift=open_shift(session,person,lock=True)
        if shift:
            raw(session,'INSERT INTO accounting.till_shift_entry(business_id,shift_id,kind,source_id,cash) VALUES(%s,%s,%s,%s,%s)',
                (str(session.business_id),str(shift.id),kind,str(source_id),cash))
            return shift.id
    return None


def before_sale(session,actor):
    """The owner may require an open shift before anyone sells."""
    if shift_policy(session)['require_shift'] and available(session) and not open_shift(session,actor):
        raise HTTPException(409,'Open your shift before selling. The owner requires a shift for every sale.')


def _audit(session,actor,key,event,details):
    raw(session,'INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,%s,%s::jsonb)',
        (str(session.business_id),str(actor),str(key),event,json.dumps(details)))


def _money(value):
    return format(value,'.2f') if value is not None else None


SHIFT_SELECT="""SELECT s.*,coalesce((SELECT nullif(to_jsonb(m)->>'display_name','') FROM public.memberships m
      WHERE m.business_id=s.business_id AND m.user_id=s.opened_by),'A team member') AS opened_by_name,
    coalesce(sum(e.cash) FILTER (WHERE e.kind='sale'),0) AS cash_sales,
    coalesce(sum(e.cash) FILTER (WHERE e.kind='refund'),0) AS cash_refunds,
    coalesce(sum(e.cash) FILTER (WHERE e.kind='pay_in'),0) AS pay_ins,
    coalesce(sum(e.cash) FILTER (WHERE e.kind='pay_out'),0) AS pay_outs,
    coalesce(sum(e.cash) FILTER (WHERE e.kind='sale_reversed'),0) AS handed_back,
    coalesce(sum(e.cash) FILTER (WHERE e.kind IN ('deposit','deposit_refund','deposit_applied')),0) AS deposits,
    count(*) FILTER (WHERE e.kind='sale') AS sales
  FROM accounting.till_shift s
  LEFT JOIN accounting.till_shift_entry e ON e.business_id=s.business_id AND e.shift_id=s.id"""
SHIFT_GROUP=' GROUP BY s.business_id,s.id'


def _expected(row):
    return row.opening_float+row.cash_sales+row.cash_refunds+row.pay_ins+row.pay_outs+row.handed_back+row.deposits


def _row(session,r,actor=None,today=None):
    today=today or business_today(session)
    from cacu.accounting.outlets import name
    return {'id':str(r.id),'status':r.status,'opened_by_name':r.opened_by_name,'outlet':name(session,getattr(r,'location_id',None)),
            'location_id':str(r.location_id) if getattr(r,'location_id',None) else None,'mine':actor is not None and str(r.opened_by)==str(actor),
            'opened_at':r.opened_at.isoformat(),'opened_on':r.opened_on.isoformat(),'overdue':r.status=='open' and r.opened_on<today,
            'opening_float':_money(r.opening_float),'sales':r.sales,'cash_sales':_money(r.cash_sales),'cash_refunds':_money(-r.cash_refunds),
            'pay_ins':_money(r.pay_ins),'pay_outs':_money(-r.pay_outs),'cash_handed_back':_money(-r.handed_back),'deposits':_money(r.deposits),
            'expected_cash':_money(r.expected_cash if r.status=='closed' else _expected(r)),
            'counted_cash':_money(r.counted_cash),'variance':_money(r.variance),'close_note':r.close_note,
            'closed_on':r.closed_on.isoformat() if r.closed_on else None,'posting':r.posting}


def _read(session,shift_id,actor=None):
    row=raw(session,SHIFT_SELECT+' WHERE s.business_id=%s AND s.id=%s'+SHIFT_GROUP,(str(session.business_id),str(shift_id))).first()
    if not row:raise HTTPException(404,'Shift not found')
    result=_row(session,row,actor)
    moves=raw(session,"""SELECT id,kind,destination,amount,reason,created_at FROM accounting.till_movement
      WHERE business_id=%s AND shift_id=%s ORDER BY created_at""",(str(session.business_id),str(shift_id))).all()
    result['movements']=[{'id':str(m.id),'kind':m.kind,'destination':m.destination,'amount':_money(m.amount),'reason':m.reason,
                          'created_at':m.created_at.isoformat()} for m in moves]
    return result


def pay_out_accounts(session):
    """What a pay-out can be spent on: the chart's expense accounts, less Cash over and short (kept for shift closes)."""
    variance=str(_variance_account(session,required=False))
    return [a for a in expense_accounts(session) if a['id']!=variance]


def current(session,actor):
    """What the till shows: whether shifts are on the plan, the owner's rule, and the person's open shift."""
    if not available(session):
        return {'available':False,'require_shift':False,'shift':None,'can_manage':False}
    from cacu.accounting import outlets
    shift=open_shift(session,actor)
    return {'available':True,**shift_policy(session),'shift':_read(session,shift.id,actor) if shift else None,
            'can_manage':bool(allowed(session,'sales.approve')),'pay_out_accounts':pay_out_accounts(session) if shift else [],
            'outlets':outlets.listed(session),'own_outlet':outlets.assigned(session,actor)}


def start(session,actor,data:ShiftOpen):
    def execute():
        _require_plan(session)
        if open_shift(session,actor):raise HTTPException(409,'You already have a shift open. Close it before opening another.')
        from cacu.accounting import outlets
        outlet=outlets.choose(session,actor,data.location_id,'Choose the outlet this till is in')
        raw(session,'INSERT INTO accounting.till_shift(business_id,id,opened_by,opened_on,opening_float,location_id) VALUES(%s,%s,%s,%s,%s,%s)',
            (str(session.business_id),str(data.request_key),str(actor),business_today(session),Decimal(data.opening_float),outlet))
        _audit(session,actor,data.request_key,'shift_opened',{'opening_float':data.opening_float,'outlet':outlet})
        return _read(session,data.request_key,actor)
    return durable(session,actor,'shift_open',data,execute)


def _locked(session,shift_id):
    shift=raw(session,'SELECT * FROM accounting.till_shift WHERE business_id=%s AND id=%s FOR UPDATE',(str(session.business_id),str(shift_id))).first()
    if not shift:raise HTTPException(404,'Shift not found')
    if shift.status!='open':raise HTTPException(409,'This shift is already closed')
    return shift


def _expected_now(session,shift_id):
    row=raw(session,SHIFT_SELECT+' WHERE s.business_id=%s AND s.id=%s'+SHIFT_GROUP,(str(session.business_id),str(shift_id))).one()
    return _expected(row)


def move(session,actor,shift_id:UUID,data:CashMovement):
    """A pay-in or pay-out on the person's own open shift."""
    def execute():
        _require_plan(session);shift_key=UUID(str(shift_id))
        shift=_locked(session,shift_key)
        if str(shift.opened_by)!=str(actor):raise HTTPException(403,'Only the cashier on this shift can pay cash in or out of it')
        reason=data.reason.strip()
        if len(reason)<3:raise HTTPException(422,'Say what the cash is for')
        amount=Decimal(data.amount)
        if amount<=0:raise HTTPException(422,'Enter an amount above zero')
        cash=collection_account(session,'Cash',None);day=business_today(session);posting_key=uuid5(data.request_key,'posting')
        if data.kind=='pay_out':
            if (data.expense_account_id is None)==(data.bank_account_id is None):
                raise HTTPException(422,'Choose what the cash was spent on, or the bank account it was paid into')
            expected=_expected_now(session,shift_key)
            if amount>expected:raise HTTPException(409,f'The till should only hold ₦{expected:,.2f}. Count the cash, or pay in first.')
            if data.expense_account_id is not None:
                # PR-17: debit the expense, credit the till.
                if str(data.expense_account_id) not in {a['id'] for a in pay_out_accounts(session)}:raise HTTPException(422,'Choose an expense account from your chart')
                destination,counter='expense',data.expense_account_id
                command=PostingCommand(request_key=posting_key,kind='expense',source_id=data.request_key,main_account_id=cash,entry_date=day,
                    narration='Paid from the till: '+reason,lines=[{'account_id':counter,'amount':data.amount}])
            else:
                # PR-21: debit the bank, credit the till.
                destination,counter='bank',collection_account(session,'Transfer',data.bank_account_id)
                command=PostingCommand(request_key=posting_key,kind='transfer',source_id=data.request_key,main_account_id=counter,entry_date=day,
                    credited=False,narration='Cash from the till to the bank: '+reason,lines=[{'account_id':cash,'amount':data.amount,'credited':True}])
        else:
            if data.expense_account_id is not None or data.bank_account_id is None:
                raise HTTPException(422,'Choose the bank account the cash came from')
            # PR-21: debit the till, credit the bank.
            destination,counter='bank',collection_account(session,'Transfer',data.bank_account_id)
            command=PostingCommand(request_key=posting_key,kind='transfer',source_id=data.request_key,main_account_id=cash,entry_date=day,
                credited=False,narration='Cash into the till from the bank: '+reason,lines=[{'account_id':counter,'amount':data.amount,'credited':True}])
        posting=post_command(session,actor,command)
        tenant=str(session.business_id)
        raw(session,"""INSERT INTO accounting.till_movement(business_id,id,shift_id,kind,destination,account_id,amount,reason,created_by,posting)
          VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb)""",(tenant,str(data.request_key),str(shift_key),data.kind,destination,str(counter),amount,reason,
          str(actor),json.dumps({'transaction_no':posting.get('transaction_no')})))
        raw(session,'INSERT INTO accounting.till_shift_entry(business_id,shift_id,kind,source_id,cash) VALUES(%s,%s,%s,%s,%s)',
            (tenant,str(shift_key),data.kind,str(data.request_key),amount if data.kind=='pay_in' else -amount))
        _audit(session,actor,data.request_key,'shift_'+data.kind,{'shift_id':str(shift_key),'amount':data.amount,'destination':destination,'reason':reason})
        return _read(session,shift_key,actor)
    return durable(session,actor,'shift_movement:'+str(shift_id),data,execute)


def _variance_account(session,required=True):
    rows=raw(session,"SELECT account_id FROM accounting.account_map WHERE business_id=%s AND purpose='cash_variance'",(str(session.business_id),)).all()
    if len(rows)!=1:
        if not required:return None
        raise HTTPException(409,'Add a Cash over and short account to your chart before closing a shift with a difference')
    return rows[0].account_id


def close(session,actor,shift_id:UUID,data:ShiftClose):
    """Counts the till. Anyone closes their own shift; closing someone else's needs sales.approve."""
    def execute():
        shift_key=UUID(str(shift_id));shift=_locked(session,shift_key)
        if str(shift.opened_by)!=str(actor) and not allowed(session,'sales.approve'):
            raise HTTPException(403,"Only the cashier, or someone who can approve sales, can close this shift")
        expected=_expected_now(session,shift_key);counted=Decimal(data.counted_cash);variance=counted-expected
        note=data.note.strip()
        if variance and len(note)<3:raise HTTPException(422,'Say what happened to the difference')
        day=business_today(session);detail=None
        if variance:
            # PR-22: a shortage debits Cash over and short and credits the till; a surplus the reverse.
            shortage=variance<0
            posting=post_command(session,actor,PostingCommand(request_key=uuid5(data.request_key,'posting'),kind='shift_variance',source_id=shift_key,
                main_account_id=collection_account(session,'Cash',None),entry_date=day,credited=shortage,
                narration=('Cash short' if shortage else 'Cash over')+' at shift close: '+note,
                lines=[{'account_id':_variance_account(session),'amount':format(abs(variance),'.2f'),'credited':not shortage}]),internal=True)
            detail={'transaction_no':posting.get('transaction_no')}
        raw(session,"""UPDATE accounting.till_shift SET status='closed',closed_by=%s,closed_at=now(),closed_on=%s,expected_cash=%s,counted_cash=%s,
          variance=%s,close_note=%s,posting=%s::jsonb WHERE business_id=%s AND id=%s""",(str(actor),day,expected,counted,variance,note or None,
          json.dumps(detail) if detail else None,str(session.business_id),str(shift_key)))
        _audit(session,actor,data.request_key,'shift_closed',{'shift_id':str(shift_key),'expected_cash':_money(expected),
               'counted_cash':_money(counted),'variance':_money(variance)})
        return _read(session,shift_key,actor)
    return durable(session,actor,'shift_close:'+str(shift_id),data,execute)


def save_shift_policy(session,actor,data:ShiftPolicy):
    _require_plan(session)
    if role(session,actor)!='owner':raise HTTPException(403,'Only the business owner can change whether shifts are required')
    raw(session,"""INSERT INTO accounting.sales_policy(business_id,require_shift,updated_by) VALUES(%s,%s,%s)
      ON CONFLICT (business_id) DO UPDATE SET require_shift=EXCLUDED.require_shift,updated_by=EXCLUDED.updated_by,updated_at=now()""",
        (str(session.business_id),data.require_shift,str(actor)))
    result=shift_policy(session)
    raw(session,"INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,gen_random_uuid(),'shift_policy',%s::jsonb)",
        (str(session.business_id),str(actor),json.dumps(result)))
    return result


def sees_all(session):
    return bool(allowed(session,'sales.approve') or allowed(session,'banking.view'))


def list_shifts(session,actor,day:date|None=None,status:str|None=None,limit=200):
    """Shifts opened or closed on a day, and every shift still open. Managers see everyone's; others see their own."""
    if status not in {None,'open','closed'}:raise HTTPException(422,'Unknown shift status')
    if not available(session):return []
    where=['s.business_id=%s'];args=[str(session.business_id)]
    if status:where.append('s.status=%s');args.append(status)
    if day:where.append("(s.opened_on=%s OR s.closed_on=%s OR s.status='open')");args+= [day,day]
    if not sees_all(session):where.append('s.opened_by=%s');args.append(str(actor))
    rows=raw(session,SHIFT_SELECT+' WHERE '+' AND '.join(where)+SHIFT_GROUP+' ORDER BY s.status DESC,s.opened_at DESC LIMIT %s',(*args,limit)).all()
    today=business_today(session)
    return [_row(session,r,actor,today) for r in rows]


def daily(session,day:date,actor):
    """For Daily reconciliation: shifts closed that day with their differences, and shifts still open."""
    if not available(session):return None
    shifts=list_shifts(session,actor,day)
    closed=[s for s in shifts if s['status']=='closed' and s['closed_on']==day.isoformat()]
    return {'closed':closed,'open':[s for s in shifts if s['status']=='open'],
            'variance_total':format(sum((Decimal(s['variance']) for s in closed),ZERO),'.2f')}
