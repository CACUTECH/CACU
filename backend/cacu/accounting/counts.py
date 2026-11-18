"""Stock counts (Doc 18 R3 "E09 counts"; Doc 09 PR-20 and month-end step 4).

Owner decision of 18 November 2026: anyone with stock permission enters counted quantities; an Owner or Admin approves
the whole count once, which posts every difference to Inventory adjustments and write-offs; the person who submitted
the count cannot approve it.

A count covers one outlet, or the whole business when it has no outlets. It lists every active product whose stock
is tracked. Expected quantities are taken again when the count is submitted, so sales made while counting are allowed
for; items left blank are not changed. Approval posts each difference as a stock adjustment, dated the day of approval,
through the existing adjustment posting (stock, valuation and the ledger together).
"""
import json
from datetime import date
from uuid import UUID, uuid5
from fastapi import HTTPException
from pydantic import BaseModel, Field
from cacu.accounting.posting import raw
from cacu.accounting.session import allowed
from cacu.accounting.workflows import business_today, role


class CountStart(BaseModel):
    request_key: UUID
    name: str = Field(min_length=1, max_length=100)
    location_id: UUID | None = None


class CountedLine(BaseModel):
    item_id: UUID
    counted: int | None = Field(default=None, ge=0, le=10_000_000)


class CountSave(BaseModel):
    lines: list[CountedLine] = Field(min_length=1, max_length=2000)


class CountDecision(BaseModel):
    note: str = Field(default='', max_length=500)


def _expected(session, item_id, location_id, total):
    from cacu.accounting import outlets
    return int(outlets.held(session, item_id, location_id)) if location_id else int(total or 0)


def _products(session):
    return raw(session, """SELECT id, name, stock_quantity FROM public.catalog_items WHERE business_id=%s AND item_type='PRODUCT'
        AND coalesce((to_jsonb(catalog_items)->>'track_stock')::boolean,true) AND is_active ORDER BY name LIMIT 2000""",
               (str(session.business_id),)).all()


def _count(session, count_id, lock=False):
    row = raw(session, f"SELECT * FROM accounting.stock_count WHERE business_id=%s AND id=%s{' FOR UPDATE' if lock else ''}",
              (str(session.business_id), str(count_id))).first()
    if row is None:
        raise HTTPException(404, 'That stock count is not in this business.')
    return row


def read(session, count_id):
    from cacu.accounting import outlets
    c = _count(session, count_id)
    lines = raw(session, """SELECT l.*, i.name, i.cost_price FROM accounting.stock_count_line l
        JOIN public.catalog_items i ON i.business_id=l.business_id AND i.id=l.item_id
        WHERE l.business_id=%s AND l.count_id=%s ORDER BY i.name""", (str(session.business_id), str(count_id))).all()
    out = [{'item_id': str(l.item_id), 'name': l.name, 'expected': l.expected, 'counted': l.counted,
            'difference': (l.counted - l.expected) if l.counted is not None else None, 'posted': l.adjustment_id is not None} for l in lines]
    return {'id': str(c.id), 'name': c.name, 'status': c.status, 'location_id': str(c.location_id) if c.location_id else None,
            'outlet': outlets.name(session, c.location_id), 'started_at': c.started_at.isoformat(),
            'submitted_at': c.submitted_at.isoformat() if c.submitted_at else None, 'submitted_by': str(c.submitted_by) if c.submitted_by else None,
            'decided_on': c.decided_on.isoformat() if c.decided_on else None, 'note': c.note, 'lines': out,
            'summary': {'items': len(out), 'counted': sum(1 for l in out if l['counted'] is not None),
                        'differences': sum(1 for l in out if l['difference'])}}


def listing(session, limit=20):
    rows = raw(session, 'SELECT id FROM accounting.stock_count WHERE business_id=%s ORDER BY started_at DESC LIMIT %s',
               (str(session.business_id), limit)).all()
    counts = [read(session, r.id) for r in rows]
    return [{k: v for k, v in c.items() if k != 'lines'} for c in counts]


def start(session, actor, data: CountStart):
    from cacu.accounting import outlets
    tenant = str(session.business_id)
    location = outlets.choose(session, actor, data.location_id, 'Choose the outlet you are counting.')
    if raw(session, 'SELECT 1 FROM accounting.stock_count WHERE business_id=%s AND id=%s', (tenant, str(data.request_key))).first():
        return read(session, data.request_key)  # a retry
    if raw(session, """SELECT 1 FROM accounting.stock_count WHERE business_id=%s AND status IN ('counting','submitted')
        AND coalesce(location_id,'00000000-0000-0000-0000-000000000000'::uuid)=coalesce(%s::uuid,'00000000-0000-0000-0000-000000000000'::uuid)""",
           (tenant, location)).first():
        raise HTTPException(409, 'A count is already open here. Finish or reject it first.')
    products = _products(session)
    if not products:
        raise HTTPException(409, 'There are no products with tracked stock to count.')
    raw(session, 'INSERT INTO accounting.stock_count(business_id,id,location_id,name,started_by) VALUES(%s,%s,%s,%s,%s)',
        (tenant, str(data.request_key), location, data.name.strip(), str(actor)))
    for p in products:
        raw(session, 'INSERT INTO accounting.stock_count_line(business_id,count_id,item_id,expected) VALUES(%s,%s,%s,%s)',
            (tenant, str(data.request_key), str(p.id), _expected(session, p.id, location, p.stock_quantity)))
    return read(session, data.request_key)


def save(session, actor, count_id, data: CountSave):
    c = _count(session, count_id, lock=True)
    if c.status != 'counting':
        raise HTTPException(409, 'This count has been submitted; it can no longer be changed.')
    tenant = str(session.business_id)
    for line in data.lines:
        done = raw(session, 'UPDATE accounting.stock_count_line SET counted=%s WHERE business_id=%s AND count_id=%s AND item_id=%s RETURNING item_id',
                   (line.counted, tenant, str(count_id), str(line.item_id))).first()
        if done is None:
            raise HTTPException(422, 'An item is not on this count.')
    return read(session, count_id)


def submit(session, actor, count_id):
    """Counting is finished: the expected quantities are taken again now, so sales made while counting are allowed for."""
    c = _count(session, count_id, lock=True)
    if c.status != 'counting':
        raise HTTPException(409, 'This count has already been submitted.')
    tenant = str(session.business_id)
    lines = raw(session, """SELECT l.item_id, l.counted, i.stock_quantity FROM accounting.stock_count_line l
        JOIN public.catalog_items i ON i.business_id=l.business_id AND i.id=l.item_id WHERE l.business_id=%s AND l.count_id=%s""",
                (tenant, str(count_id))).all()
    if not any(l.counted is not None for l in lines):
        raise HTTPException(422, 'Enter at least one counted quantity before submitting.')
    for l in lines:
        raw(session, 'UPDATE accounting.stock_count_line SET expected=%s WHERE business_id=%s AND count_id=%s AND item_id=%s',
            (_expected(session, l.item_id, c.location_id, l.stock_quantity), tenant, str(count_id), str(l.item_id)))
    raw(session, "UPDATE accounting.stock_count SET status='submitted',submitted_by=%s,submitted_at=now() WHERE business_id=%s AND id=%s",
        (str(actor), tenant, str(count_id)))
    return read(session, count_id)


def _approver(session, actor, c):
    if role(session, actor) not in {'owner', 'admin'} or not allowed(session, 'inventory.approve'):
        raise HTTPException(403, 'Only the business owner or an Admin can approve a stock count.')
    if str(c.submitted_by) == str(actor):
        raise HTTPException(403, 'Someone else must approve a count you submitted.')


def approve(session, actor, count_id, data: CountDecision):
    """Posts every difference as a stock adjustment, at the counted outlet, dated today."""
    from cacu.accounting import outlets
    from cacu.accounting.stock import _check, _item, _post
    c = _count(session, count_id, lock=True)
    if c.status != 'submitted':
        raise HTTPException(409, 'Only a submitted count can be approved.')
    _approver(session, actor, c)
    tenant, day = str(session.business_id), business_today(session)
    outlets.use(session, c.location_id)
    lines = raw(session, """SELECT l.*, i.name FROM accounting.stock_count_line l JOIN public.catalog_items i ON i.business_id=l.business_id AND i.id=l.item_id
        WHERE l.business_id=%s AND l.count_id=%s AND l.counted IS NOT NULL AND l.counted<>l.expected ORDER BY i.name""", (tenant, str(count_id))).all()
    posted = []
    for line in lines:
        delta = line.counted - line.expected
        item = _item(session, line.item_id)
        cost, value = _check(session, item, delta, day)
        key = uuid5(UUID(str(count_id)), str(line.item_id))
        raw(session, """INSERT INTO accounting.stock_adjustment(business_id,id,item_id,delta,reason,entry_date,unit_cost,value,requested_by)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)""", (tenant, str(key), str(line.item_id), delta, f'Stock count: {c.name}', day, cost, value, str(c.submitted_by)))
        _post(session, actor, key, f'Approved with stock count {c.name}')
        raw(session, 'UPDATE accounting.stock_count_line SET adjustment_id=%s WHERE business_id=%s AND count_id=%s AND item_id=%s',
            (str(key), tenant, str(count_id), str(line.item_id)))
        posted.append({'item': line.name, 'difference': delta, 'value': format(value, '.2f')})
    raw(session, "UPDATE accounting.stock_count SET status='approved',decided_by=%s,decided_at=now(),decided_on=%s,note=%s WHERE business_id=%s AND id=%s",
        (str(actor), day, data.note.strip() or None, tenant, str(count_id)))
    raw(session, 'INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,%s,%s::jsonb)',
        (tenant, str(actor), str(count_id), 'stock_count_approved', json.dumps({'name': c.name, 'adjustments': posted})))
    return read(session, count_id)


def reject(session, actor, count_id, data: CountDecision):
    c = _count(session, count_id, lock=True)
    if c.status != 'submitted':
        raise HTTPException(409, 'Only a submitted count can be rejected.')
    _approver(session, actor, c)
    if len(data.note.strip()) < 3:
        raise HTTPException(422, 'Say why the count is rejected, so it can be counted again.')
    raw(session, "UPDATE accounting.stock_count SET status='rejected',decided_by=%s,decided_at=now(),decided_on=%s,note=%s WHERE business_id=%s AND id=%s",
        (str(actor), business_today(session), data.note.strip(), str(session.business_id), str(count_id)))
    return read(session, count_id)


def counted_in(session, start: date, end: date) -> date | None:
    """The last day a count was approved between the dates, for the month-end checklist."""
    return raw(session, "SELECT max(decided_on) FROM accounting.stock_count WHERE business_id=%s AND status='approved' AND decided_on BETWEEN %s AND %s",
               (str(session.business_id), start, end)).scalar()
