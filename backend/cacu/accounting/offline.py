"""Offline selling, part 1 (Doc 10 E17, Doc 13; owner decisions of 7 November 2026).

A till that loses its connection keeps selling for cash or transfer; the device keeps each sale under its request key
and sends it here when it is back online. A sale posts as sold, dated the day it was made, from its outlet, when its
prices were the catalogue prices at that moment and its discounts are within the seller's limit; stock that ran short
meanwhile is listed as a shortfall rather than refused, since the money was taken. Anything else waits for someone who
approves sales: they post it as sold or discard it with a reason. A sale already posted under its key (an online attempt
whose answer was lost) is reported as posted, so nothing is sold twice and nothing captured offline is lost."""
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
import json
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from python_accounting.models import ReportingPeriod
from cacu.accounting import outlets
from cacu.accounting.posting import raw
from cacu.accounting.session import allowed
from cacu.accounting.workflows import SaleCreate, business_today, sale_create

AMOUNT = r'^[0-9]{1,13}(\.[0-9]{1,2})?$'
CENT = Decimal('0.01')
LAGOS = ZoneInfo('Africa/Lagos')
REASONS = {'price': 'A price differs from the catalogue price at the time of the sale',
           'discount': "A discount is above the seller's limit",
           'valuation_stock': 'A product on the adopted valuation did not have the stock',
           'closed_period': 'The sale is dated in a closed period or before the books started',
           'too_old': 'The sale reached CACU more than 7 days after it was made, or the device clock was wrong',
           'item_unavailable': 'A product is no longer active in the catalogue'}


class OfflineLine(BaseModel):
    model_config = ConfigDict(extra='forbid')
    item_id: UUID
    quantity: int = Field(gt=0, le=10000)
    unit_price: str = Field(pattern=AMOUNT)
    discount_percent: str = Field(default='0', pattern=r'^\d{1,3}(\.\d{1,2})?$')


class OfflineSale(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: UUID
    sold_at: datetime
    method: Literal['Cash', 'Transfer']
    bank_account_id: UUID | None = None
    cash_received: str | None = Field(default=None, pattern=AMOUNT)
    location_id: UUID | None = None
    quoted_total: str = Field(pattern=AMOUNT)
    items: list[OfflineLine] = Field(min_length=1, max_length=100)


class OfflineDecision(BaseModel):
    model_config = ConfigDict(extra='forbid')
    decision: Literal['post', 'discard']
    note: str = Field(default='', max_length=500)


def _total(data: OfflineSale):
    total = Decimal('0')
    for line in data.items:
        gross = Decimal(line.unit_price) * line.quantity
        total += gross - (gross * Decimal(line.discount_percent) / 100).quantize(CENT, rounding=ROUND_HALF_UP)
    return total


def _day(data: OfflineSale):
    moment = data.sold_at if data.sold_at.tzinfo else data.sold_at.replace(tzinfo=timezone.utc)
    return moment.astimezone(LAGOS).date()


def _naira(value):
    return f'₦{Decimal(value):,.2f}'


def _problem(session, data: OfflineSale, outlet):
    """(reason, detail) when the sale needs review, else None."""
    tenant = str(session.business_id)
    now = datetime.now(timezone.utc)
    sold = data.sold_at if data.sold_at.tzinfo else data.sold_at.replace(tzinfo=timezone.utc)
    if sold > now + timedelta(minutes=10) or sold < now - timedelta(days=7):
        return 'too_old', f'Made {sold.astimezone(LAGOS):%d %b %Y %H:%M}'
    day = _day(data)
    cutover = raw(session, 'SELECT cutover_date FROM accounting.business_map WHERE business_id=%s', (tenant,)).scalar()
    period = ReportingPeriod.get_period(session, datetime.combine(day, time(12)))
    if day < cutover or day > business_today(session) or period.status == ReportingPeriod.Status.CLOSED:
        return 'closed_period', f'Dated {day:%d %b %Y}'
    cap = Decimal(raw(session, 'SELECT authz.discount_cap(%s)', (tenant,)).scalar() or 0)
    for line in data.items:
        row = raw(session, """SELECT name,unit_price,item_type,coalesce((to_jsonb(catalog_items)->>'track_stock')::boolean,true) AS track_stock
          FROM public.catalog_items WHERE business_id=%s AND id=%s AND is_active""", (tenant, str(line.item_id))).first()
        if not row or not row.unit_price or row.unit_price <= 0:
            return 'item_unavailable', 'A product sold is no longer active'
        then = raw(session, 'SELECT accounting.price_at(%s,%s,%s)', (tenant, str(line.item_id), sold)).scalar()
        if then is None or Decimal(line.unit_price) != Decimal(then):
            return 'price', f'{row.name}: sold at {_naira(line.unit_price)}, catalogue price then {_naira(then or 0)}'
        if Decimal(line.discount_percent) > cap:
            return 'discount', f'{row.name}: {Decimal(line.discount_percent).normalize():f}% off; the limit is {cap.normalize():f}%'
        if row.item_type == 'PRODUCT' and row.track_stock and raw(session, 'SELECT 1 FROM accounting.inventory_valuation WHERE business_id=%s AND item_id=%s',
                                                                  (tenant, str(line.item_id))).first():
            outlets.use(session, outlet)
            gap = outlets.short(session, line.item_id, line.quantity)
            total_held = raw(session, 'SELECT coalesce(stock_quantity,0) FROM public.catalog_items WHERE business_id=%s AND id=%s', (tenant, str(line.item_id))).scalar()
            if gap or total_held < line.quantity:
                return 'valuation_stock', f'{row.name}: {line.quantity} sold, {gap[0] if gap else max(total_held, 0)} in stock'
    return None


def _post(session, actor, data: OfflineSale, outlet):
    sale = SaleCreate(request_key=data.request_key, entry_date=_day(data), method=data.method, bank_account_id=data.bank_account_id,
                      quoted_total=format(_total(data), '.2f'), cash_received=data.cash_received,
                      items=[{'item_id': l.item_id, 'quantity': l.quantity, 'discount_percent': l.discount_percent} for l in data.items])
    return sale_create(session, actor, sale, offline={'prices': {str(l.item_id): l.unit_price for l in data.items}, 'outlet': outlet})


def _outlet(session, data: OfflineSale):
    if data.location_id is None: return None
    known = {o['id'] for o in outlets.listed(session, include_closed=True)}
    return str(data.location_id) if str(data.location_id) in known else None


def sync(session, actor, data: OfflineSale):
    tenant = str(session.business_id); key = str(data.request_key)
    if _total(data) != Decimal(data.quoted_total): raise HTTPException(422, 'The offline sale does not add up')
    if raw(session, "SELECT 1 FROM accounting.document_map WHERE business_id=%s AND source_type='pos' AND source_id=%s", (tenant, key)).first():
        return {'status': 'posted', 'sale_id': key, 'shortfalls': []}
    seen = raw(session, 'SELECT status,reason,detail FROM accounting.offline_sale WHERE business_id=%s AND id=%s', (tenant, key)).first()
    if seen: return {'status': seen.status, 'sale_id': key, 'reason': seen.reason, 'detail': seen.detail}
    outlet = _outlet(session, data)
    problem = _problem(session, data, outlet)
    payload = data.model_dump(mode='json')
    if problem:
        raw(session, """INSERT INTO accounting.offline_sale(business_id,id,sold_by,sold_at,payload,status,reason,detail)
          VALUES(%s,%s,%s,%s,%s::jsonb,'review',%s,%s)""", (tenant, key, str(actor), data.sold_at, json.dumps(payload), problem[0], problem[1][:500]))
        return {'status': 'review', 'sale_id': key, 'reason': problem[0], 'detail': problem[1]}
    result = _post(session, actor, data, outlet)
    raw(session, """INSERT INTO accounting.offline_sale(business_id,id,sold_by,sold_at,payload,status) VALUES(%s,%s,%s,%s,%s::jsonb,'posted')""",
        (tenant, key, str(actor), data.sold_at, json.dumps(payload)))
    return {'status': 'posted', 'sale_id': key, 'shortfalls': result.get('shortfalls', [])}


def review_list(session, actor):
    """Sales waiting for review: all of them for people who approve sales, else the person's own."""
    everyone = bool(allowed(session, 'sales.approve'))
    rows = raw(session, f"""SELECT o.*,coalesce((SELECT nullif(to_jsonb(m)->>'display_name','') FROM public.memberships m
        WHERE m.business_id=o.business_id AND m.user_id=o.sold_by),'A team member') AS seller
      FROM accounting.offline_sale o WHERE o.business_id=%s AND o.status='review'{'' if everyone else ' AND o.sold_by=%s'}
      ORDER BY o.received_at LIMIT 200""", (str(session.business_id),) if everyone else (str(session.business_id), str(actor))).all()
    names = {}
    out = []
    for r in rows:
        items = []
        for line in r.payload['items']:
            if line['item_id'] not in names:
                names[line['item_id']] = raw(session, 'SELECT name FROM public.catalog_items WHERE business_id=%s AND id=%s',
                                             (str(session.business_id), line['item_id'])).scalar() or 'Product'
            items.append({'name': names[line['item_id']], 'quantity': line['quantity'], 'unit_price': line['unit_price'], 'discount_percent': line['discount_percent']})
        out.append({'id': str(r.id), 'seller': r.seller, 'sold_at': r.sold_at.isoformat(), 'method': r.payload['method'], 'total': r.payload['quoted_total'],
                    'reason': r.reason, 'reason_text': REASONS.get(r.reason, r.reason), 'detail': r.detail, 'items': items})
    return {'can_decide': everyone, 'sales': out}


def decide(session, actor, sale_id: UUID, data: OfflineDecision):
    if not allowed(session, 'sales.approve'): raise HTTPException(403, 'Only people who approve sales can post or discard an offline sale')
    tenant = str(session.business_id)
    row = raw(session, 'SELECT * FROM accounting.offline_sale WHERE business_id=%s AND id=%s FOR UPDATE', (tenant, str(sale_id))).first()
    if not row: raise HTTPException(404, 'Offline sale not found')
    if row.status != 'review': raise HTTPException(409, 'This offline sale has already been decided')
    note = data.note.strip()
    if data.decision == 'discard':
        if len(note) < 3: raise HTTPException(422, 'Say why this sale is discarded')
        result = {'status': 'discarded', 'sale_id': str(sale_id)}
    else:
        sale = OfflineSale.model_validate(row.payload)
        if _day(sale) < raw(session, 'SELECT cutover_date FROM accounting.business_map WHERE business_id=%s', (tenant,)).scalar():
            raise HTTPException(409, 'This sale is dated before the books started. Discard it and record it another way.')
        posted = _post(session, actor, sale, _outlet(session, sale))
        result = {'status': 'posted', 'sale_id': str(sale_id), 'shortfalls': posted.get('shortfalls', [])}
    raw(session, 'UPDATE accounting.offline_sale SET status=%s,decided_by=%s,decided_at=now(),note=%s WHERE business_id=%s AND id=%s',
        (result['status'], str(actor), note or None, tenant, str(sale_id)))
    raw(session, "INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,'offline_sale_decided',%s::jsonb)",
        (tenant, str(actor), str(sale_id), json.dumps({'decision': data.decision, 'reason': row.reason})))
    return result
