"""Purchasing, part 4b: transfers between outlets (Doc 10; owner decision of 7 November 2026: send, then receive).

The sending outlet sends goods (TR-0001): they leave its stock and are in transit, still the business's at the same cost,
so neither the product's total nor the books change. The receiving outlet confirms what arrived, which goes into its
stock; anything that did not arrive is a loss with a reason, taken out of the total at the product's cost and posted
Dr Stock adjustments and write-offs, Cr Inventory. A person tied to one outlet sends only from it and receives only
into it. Both steps are replay-safe under their request keys; transfers come with purchasing (Oga and Chairman)."""
from decimal import Decimal, ROUND_HALF_UP
import json
from uuid import UUID, uuid5
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from cacu.accounting import inventory, outlets
from cacu.accounting.posting import PostingCommand, post_command, raw
from cacu.accounting.purchasing import _next_number, _plan
from cacu.accounting.workflows import business_today, durable, purpose

ZERO = Decimal('0')
CENT = Decimal('0.01')


class TransferLine(BaseModel):
    model_config = ConfigDict(extra='forbid')
    item_id: UUID
    quantity: int = Field(gt=0, le=1000000)


class TransferSend(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: UUID
    from_location: UUID
    to_location: UUID
    note: str = Field(default='', max_length=500)
    lines: list[TransferLine] = Field(min_length=1, max_length=100)


class ArrivedLine(BaseModel):
    model_config = ConfigDict(extra='forbid')
    item_id: UUID
    received_quantity: int = Field(ge=0, le=1000000)


class TransferReceive(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: UUID
    note: str = Field(default='', max_length=500)
    lines: list[ArrivedLine] = Field(min_length=1, max_length=100)


def _audit(session, actor, key, event, details):
    raw(session, 'INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,%s,%s::jsonb)',
        (str(session.business_id), str(actor), str(key), event, json.dumps(details)))


def _product(session, item_id):
    row = raw(session, """SELECT name,stock_quantity,cost_price FROM public.catalog_items WHERE business_id=%s AND id=%s AND item_type='PRODUCT'
      AND coalesce((to_jsonb(catalog_items)->>'track_stock')::boolean,true) FOR UPDATE""", (str(session.business_id), str(item_id))).first()
    if not row: raise HTTPException(422, 'Only products whose stock you track can be transferred')
    return row


def _move(session, location, item_id, change):
    raw(session, """INSERT INTO accounting.outlet_stock(business_id,location_id,item_id,quantity) VALUES(%s,%s,%s,%s)
      ON CONFLICT (business_id,location_id,item_id) DO UPDATE SET quantity=accounting.outlet_stock.quantity+EXCLUDED.quantity""",
        (str(session.business_id), str(location), str(item_id), change))


def send(session, actor, data: TransferSend):
    def execute():
        _plan(session)
        tenant = str(session.business_id); source = str(data.from_location); target = str(data.to_location)
        places = {o['id']: o for o in outlets.listed(session, include_closed=True)}
        if source not in places or target not in places: raise HTTPException(422, 'Choose two of your outlets')
        if source == target: raise HTTPException(422, 'Send the goods to a different outlet')
        if not places[target]['is_active']: raise HTTPException(422, f"{places[target]['name']} is closed. Reopen it before sending goods there.")
        own = outlets.assigned(session, actor)
        if own is not None and own != source: raise HTTPException(403, f'You work at {places.get(own, {}).get("name", "another outlet")}, so you can only send goods from there')
        if len({l.item_id for l in data.lines}) != len(data.lines): raise HTTPException(422, 'Each product appears once in a transfer')
        for line in sorted(data.lines, key=lambda l: str(l.item_id)):
            product = _product(session, line.item_id)
            held = outlets.held(session, line.item_id, source)
            if held < line.quantity: raise HTTPException(409, f"Only {max(held, 0)} x {product.name} at {places[source]['name']}")
            _move(session, source, line.item_id, -line.quantity)
        number = _next_number(session, 'stock_transfer', 'TR-')
        raw(session, """INSERT INTO accounting.stock_transfer(business_id,id,number,from_location,to_location,note,sent_by,sent_on)
          VALUES(%s,%s,%s,%s,%s,%s,%s,%s)""", (tenant, str(data.request_key), number, source, target, data.note.strip(), str(actor), business_today(session)))
        for line in data.lines:
            raw(session, 'INSERT INTO accounting.stock_transfer_line(business_id,transfer_id,item_id,quantity) VALUES(%s,%s,%s,%s)',
                (tenant, str(data.request_key), str(line.item_id), line.quantity))
        _audit(session, actor, data.request_key, 'stock_sent', {'number': number, 'from': source, 'to': target})
        return detail(session, data.request_key)
    return durable(session, actor, 'stock_transfer', data, execute)


def _lose(session, actor, key, item_id, quantity, day, reason):
    """Takes goods lost in transit out of the total at the product's cost; returns their value."""
    product = _product(session, item_id)
    valuation = inventory.state(session, item_id)
    if valuation:
        inventory.dated(session, day, valuation)
        if (product.stock_quantity or 0) != valuation.quantity: raise HTTPException(409, 'Stock quantities do not reconcile to valuation')
        gross = inventory.proportion(valuation.gross_cost, quantity, valuation.quantity)
        allowance = inventory.proportion(valuation.allowance, quantity, valuation.quantity)
        when = max(day, valuation.last_date)
        inventory.update(session, item_id, valuation.quantity - quantity, valuation.gross_cost - gross, valuation.allowance - allowance, when)
        inventory.event(session, actor, uuid5(key, 'lost:' + str(item_id)), item_id, 'adjustment', when, -quantity, -gross, -allowance, key, {'lost_in_transit': reason})
        inventory.allowance_post(session, actor, uuid5(key, 'allowance:' + str(item_id)), day, -allowance, 'Goods lost in transit')
        value = gross
    else:
        value = ((product.cost_price or ZERO) * quantity).quantize(CENT, rounding=ROUND_HALF_UP)
    raw(session, 'UPDATE public.catalog_items SET stock_quantity=stock_quantity-%s WHERE business_id=%s AND id=%s', (quantity, str(session.business_id), str(item_id)))
    raw(session, 'INSERT INTO accounting.stock_event(business_id,source_id,item_id,quantity,unit_cost) VALUES(%s,%s,%s,%s,%s)',
        (str(session.business_id), str(key), str(item_id), -quantity, (value / quantity).quantize(Decimal('0.0001'))))
    return value


def receive(session, actor, transfer_id: UUID, data: TransferReceive):
    def execute():
        _plan(session)
        tenant = str(session.business_id); key = UUID(str(transfer_id)); day = business_today(session)
        transfer = raw(session, 'SELECT * FROM accounting.stock_transfer WHERE business_id=%s AND id=%s FOR UPDATE', (tenant, str(key))).first()
        if not transfer: raise HTTPException(404, 'Transfer not found')
        if transfer.status != 'in_transit': raise HTTPException(409, 'This transfer has already been received')
        own = outlets.assigned(session, actor)
        if own is not None and own != str(transfer.to_location):
            raise HTTPException(403, f'Only someone at {outlets.name(session, transfer.to_location)} can receive this transfer')
        sent = {str(r.item_id): r for r in raw(session, 'SELECT * FROM accounting.stock_transfer_line WHERE business_id=%s AND transfer_id=%s FOR UPDATE',
                                               (tenant, str(key))).all()}
        arrived = {str(l.item_id): l.received_quantity for l in data.lines}
        if len(arrived) != len(data.lines) or set(arrived) != set(sent): raise HTTPException(422, 'Say how many of each product arrived')
        for item_id, quantity in arrived.items():
            if quantity > sent[item_id].quantity: raise HTTPException(422, f'Only {sent[item_id].quantity} of that product were sent')
        lost = {i: sent[i].quantity - q for i, q in arrived.items() if q < sent[i].quantity}
        reason = data.note.strip()
        if lost and len(reason) < 3: raise HTTPException(422, 'Say why some goods did not arrive')
        for item_id in sorted(arrived):
            _product(session, item_id)
            if arrived[item_id]: _move(session, transfer.to_location, item_id, arrived[item_id])
        loss = ZERO; posting = None
        if lost:
            raw(session, "SELECT set_config('cacu.outlet','none',true)")  # lost on the way: at no outlet
            for item_id in sorted(lost):
                loss += _lose(session, actor, key, item_id, lost[item_id], day, reason)
            outlets.use(session, None)
            if loss:
                from cacu.accounting.stock import adjustment_offset
                loss_key = uuid5(key, 'lost')
                posting = post_command(session, actor, PostingCommand(request_key=loss_key, source_id=loss_key, kind='adjustment', main_account_id=purpose(session, 'inventory'),
                    entry_date=day, credited=True, narration=f'Lost in transfer {transfer.number}: {reason}',
                    lines=[{'account_id': adjustment_offset(session), 'amount': format(loss, '.2f'), 'credited': False}]), managed_stock=True)
                raw(session, 'INSERT INTO accounting.inventory_journal(business_id,source_id) VALUES(%s,%s)', (tenant, str(loss_key)))
        for item_id, quantity in arrived.items():
            raw(session, 'UPDATE accounting.stock_transfer_line SET received_quantity=%s WHERE business_id=%s AND transfer_id=%s AND item_id=%s',
                (quantity, tenant, str(key), item_id))
        raw(session, """UPDATE accounting.stock_transfer SET status='received',received_by=%s,received_on=%s,received_at=now(),receive_note=%s,loss_value=%s,posting=%s::jsonb
          WHERE business_id=%s AND id=%s""", (str(actor), day, reason or None, loss,
          json.dumps({'transaction_no': posting.get('transaction_no')}) if posting else None, tenant, str(key)))
        _audit(session, actor, data.request_key, 'stock_received', {'number': transfer.number, 'lost': {i: q for i, q in lost.items()}, 'loss': format(loss, '.2f')})
        return detail(session, key)
    return durable(session, actor, 'stock_transfer_receive:' + str(transfer_id), data, execute)


def _row(session, t):
    return {'id': str(t.id), 'number': t.number, 'status': t.status, 'from_location': str(t.from_location), 'to_location': str(t.to_location),
            'from_name': outlets.name(session, t.from_location), 'to_name': outlets.name(session, t.to_location), 'note': t.note,
            'sent_on': t.sent_on.isoformat(), 'received_on': t.received_on.isoformat() if t.received_on else None,
            'receive_note': t.receive_note, 'loss_value': format(t.loss_value, '.2f') if t.loss_value is not None else None,
            'items': getattr(t, 'items', None)}


def detail(session, transfer_id):
    tenant = str(session.business_id)
    t = raw(session, 'SELECT * FROM accounting.stock_transfer WHERE business_id=%s AND id=%s', (tenant, str(transfer_id))).first()
    if not t: raise HTTPException(404, 'Transfer not found')
    lines = raw(session, """SELECT l.item_id,l.quantity,l.received_quantity,c.name FROM accounting.stock_transfer_line l
      JOIN public.catalog_items c ON c.business_id=l.business_id AND c.id=l.item_id WHERE l.business_id=%s AND l.transfer_id=%s ORDER BY c.name""",
                (tenant, str(transfer_id))).all()
    result = _row(session, t)
    result['items'] = len(lines)
    result['lines'] = [{'item_id': str(l.item_id), 'name': l.name, 'quantity': l.quantity, 'received_quantity': l.received_quantity,
                        'lost_quantity': l.quantity - l.received_quantity if l.received_quantity is not None else None} for l in lines]
    return result


def list_transfers(session, status: str | None = None, limit=200):
    tenant = str(session.business_id)
    rows = raw(session, f"""SELECT t.*,(SELECT count(*) FROM accounting.stock_transfer_line l WHERE l.business_id=t.business_id AND l.transfer_id=t.id) AS items
      FROM accounting.stock_transfer t WHERE t.business_id=%s{' AND t.status=%s' if status else ''} ORDER BY t.sent_at DESC LIMIT %s""",
               (tenant, status, limit) if status else (tenant, limit)).all()
    return [_row(session, r) for r in rows]
