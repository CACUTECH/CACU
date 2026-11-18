"""Batches and expiry dates (Doc 18 R3 "E09 counts and batches", part 2).

Owner decision of 18 November 2026: products marked "track batches" get a batch number and expiry date when goods are
received; CACU keeps how many of each batch are left and takes stock leaving from the batch that expires first. The
database keeps batches in step with the stock total (accounting.batch_follow); this module turns tracking on and off,
lists batches and what is expiring, names the batch for a receipt or a write-off, and writes an expired batch off.
"""
from datetime import date, timedelta
from uuid import UUID
from fastapi import HTTPException
from pydantic import BaseModel, Field
from cacu.accounting.posting import raw
from cacu.accounting.workflows import business_today, role

SOON = 30  # days


class BatchTracking(BaseModel):
    item_id: UUID
    track: bool


class BatchWriteOff(BaseModel):
    request_key: UUID
    quantity: int = Field(gt=0, le=10_000_000)
    reason: str = Field(min_length=3, max_length=500)


def tracked(session, item_id) -> bool:
    return bool(raw(session, 'SELECT 1 FROM accounting.batch_item WHERE business_id=%s AND item_id=%s',
                    (str(session.business_id), str(item_id))).first())


def name_incoming(session, batch_no: str | None, expiry: date | None):
    """The batch the next stock coming in belongs to (until cleared)."""
    raw(session, "SELECT set_config('cacu.batch_no',%s,true), set_config('cacu.batch_expiry',%s,true), set_config('cacu.batch_filled','',true)",
        ((batch_no or '').strip(), expiry.isoformat() if expiry else ''))


def filled(session) -> str | None:
    return raw(session, "SELECT nullif(current_setting('cacu.batch_filled', true), '')").scalar()


def name_outgoing(session, batch_id):
    """The batch the next stock leaving comes from first (until cleared)."""
    raw(session, "SELECT set_config('cacu.batch_id',%s,true)", (str(batch_id) if batch_id else '',))


def clear(session):
    raw(session, "SELECT set_config('cacu.batch_no','',true), set_config('cacu.batch_expiry','',true), set_config('cacu.batch_id','',true)")


def set_tracking(session, actor, data: BatchTracking):
    """Turning tracking on puts today's stock in "no batch recorded"; later receipts add real batches. Turning it off
    forgets the batches; the stock total does not change."""
    if role(session, actor) not in {'owner', 'admin'}:
        raise HTTPException(403, 'Only the business owner or an Admin can change batch tracking.')
    tenant = str(session.business_id)
    item = raw(session, """SELECT stock_quantity FROM public.catalog_items WHERE business_id=%s AND id=%s AND item_type='PRODUCT' AND is_active
        AND coalesce((to_jsonb(catalog_items)->>'track_stock')::boolean,true)""", (tenant, str(data.item_id))).first()
    if item is None:
        raise HTTPException(422, 'Choose an active product whose stock is tracked.')
    if data.track and not tracked(session, data.item_id):
        raw(session, 'INSERT INTO accounting.batch_item(business_id,item_id,started_by) VALUES(%s,%s,%s)', (tenant, str(data.item_id), str(actor)))
        if (item.stock_quantity or 0) != 0:
            raw(session, 'INSERT INTO accounting.stock_batch(business_id,item_id,quantity) VALUES(%s,%s,%s)', (tenant, str(data.item_id), item.stock_quantity))
    elif not data.track:
        raw(session, 'DELETE FROM accounting.stock_batch WHERE business_id=%s AND item_id=%s', (tenant, str(data.item_id)))
        raw(session, 'DELETE FROM accounting.batch_item WHERE business_id=%s AND item_id=%s', (tenant, str(data.item_id)))
    return overview(session)


def overview(session):
    """Every product with tracked stock, whether it tracks batches, and each tracked product's batches still in stock."""
    today = business_today(session)
    tenant = str(session.business_id)
    items = raw(session, """SELECT c.id::text AS id, c.name, c.stock_quantity, b.item_id IS NOT NULL AS tracked FROM public.catalog_items c
        LEFT JOIN accounting.batch_item b ON b.business_id=c.business_id AND b.item_id=c.id
        WHERE c.business_id=%s AND c.item_type='PRODUCT' AND c.is_active AND coalesce((to_jsonb(c)->>'track_stock')::boolean,true)
        ORDER BY c.name LIMIT 1000""", (tenant,)).all()
    batches = raw(session, """SELECT id::text, item_id::text, batch_no, expiry, quantity, received_on FROM accounting.stock_batch
        WHERE business_id=%s AND quantity<>0 ORDER BY expiry NULLS LAST, created_at""", (tenant,)).all()

    def state(expiry):
        if expiry is None:
            return 'unknown'
        return 'expired' if expiry < today else 'soon' if expiry <= today + timedelta(days=SOON) else 'ok'
    by_item = {}
    for b in batches:
        by_item.setdefault(b.item_id, []).append({'id': b.id, 'batch_no': b.batch_no, 'expiry': b.expiry.isoformat() if b.expiry else None,
            'quantity': b.quantity, 'received_on': b.received_on.isoformat() if b.received_on else None, 'state': state(b.expiry),
            'days_left': (b.expiry - today).days if b.expiry else None})
    out = [{'id': i.id, 'name': i.name, 'stock': i.stock_quantity or 0, 'tracked': i.tracked, 'batches': by_item.get(i.id, []) if i.tracked else []} for i in items]
    attention = [{'item': i['name'], **b} for i in out for b in i['batches'] if b['state'] in {'expired', 'soon'} and b['quantity'] > 0]
    return {'items': out, 'attention': sorted(attention, key=lambda b: b['expiry'] or '9999'), 'soon_days': SOON}


def write_off(session, actor, batch_id, data: BatchWriteOff):
    """An expired or damaged batch leaves stock as a stock adjustment taken from that batch (with its approval rules)."""
    from cacu.accounting.stock import AdjustmentRequest, request_adjustment
    tenant = str(session.business_id)
    batch = raw(session, 'SELECT * FROM accounting.stock_batch WHERE business_id=%s AND id=%s', (tenant, str(batch_id))).first()
    if batch is None:
        raise HTTPException(404, 'That batch is not in this business.')
    if data.quantity > batch.quantity:
        raise HTTPException(409, f'This batch has only {batch.quantity} left.')
    version = raw(session, 'SELECT version FROM public.catalog_items WHERE business_id=%s AND id=%s', (tenant, str(batch.item_id))).scalar()
    label = batch.batch_no or 'no batch recorded'
    made = request_adjustment(session, actor, AdjustmentRequest(request_key=data.request_key, item_id=batch.item_id, expected_version=version,
                              delta=-data.quantity, reason=f'{data.reason.strip()} (batch {label})', entry_date=business_today(session)), batch_id=batch_id)
    return made
