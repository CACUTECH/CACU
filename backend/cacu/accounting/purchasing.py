"""Purchasing, part 2: goods received and supplier returns (Doc 10 purchase-to-payment and rules; Doc 09 PR-18).

Goods arrive against a sent purchase order or on their own. Stock goes up at the actual cost and the weighted-average
cost is recalculated (products on the adopted IFRS valuation keep their valuation records instead); the receipt posts
Dr Inventory, Cr Goods received not invoiced (2010), which the supplier's bill clears in part 3. A receipt is posted once.
A supplier return takes goods back out at the cost they were received at (Dr Goods received not invoiced, Cr Inventory),
for quantities not yet billed. Both are replay-safe under their request keys. Purchasing is on Oga and Chairman."""
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
import json
from uuid import NAMESPACE_URL, UUID, uuid5
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from cacu.accounting import inventory
from cacu.accounting.posting import PostingCommand, post_command, raw
from cacu.accounting.workflows import business_today, durable, purpose

ZERO = Decimal('0')
CENT = Decimal('0.01')
COST = r'^[0-9]{1,13}(\.[0-9]{1,4})?$'
GRNI_NAME = 'Goods received not invoiced'
PLAN_MESSAGE = 'Purchasing comes with the Oga and Chairman plans. Upgrade in Billing to use it.'


class ReceiveLine(BaseModel):
    model_config = ConfigDict(extra='forbid')
    item_id: UUID
    quantity: int = Field(gt=0, le=1000000)
    unit_cost: str = Field(pattern=COST)


class GoodsReceive(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: UUID
    order_id: UUID | None = None
    supplier_id: UUID | None = None
    location_id: UUID | None = None
    note: str = Field(default='', max_length=500)
    lines: list[ReceiveLine] = Field(min_length=1, max_length=100)


class ReturnLine(BaseModel):
    model_config = ConfigDict(extra='forbid')
    item_id: UUID
    quantity: int = Field(gt=0, le=1000000)


class SupplierReturn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: UUID
    reason: str = Field(min_length=3, max_length=500)
    lines: list[ReturnLine] = Field(min_length=1, max_length=100)


def _money(value):
    return format(value, '.2f') if value is not None else None


def _plan(session):
    if not raw(session, 'SELECT public.purchasing_allowed(%s)', (str(session.business_id),)).scalar():
        raise HTTPException(403, PLAN_MESSAGE)


def grni_account(session):
    row = raw(session, "SELECT m.account_id FROM accounting.account_map m JOIN public.accounts a ON a.id=m.account_id AND a.business_id=m.business_id "
              "WHERE m.business_id=%s AND m.purpose='grni' AND a.is_active", (str(session.business_id),)).first()
    return row.account_id if row else None


def _ensure_grni(session, actor):
    """Goods received not invoiced is added to the chart the first time goods are received (by an owner or admin)."""
    found = grni_account(session)
    if found: return found
    from cacu.accounting.accounts import add_account
    try:
        add_account(session, actor, uuid5(NAMESPACE_URL, f'cacu:grni:{session.business_id}'), 'grni', GRNI_NAME)
    except HTTPException as refused:
        if refused.status_code == 403:
            raise HTTPException(409, 'The first delivery must be received by the owner or an admin: it adds "Goods received not invoiced" to your chart.') from refused
        raise
    return grni_account(session)


def _cost(value):
    return Decimal(value).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)


def _set_cost(session, item_id, source_id, cost):
    """Records the weighted average this receipt or return set, so the catalogue guard lets exactly that change through."""
    tenant = str(session.business_id)
    raw(session, 'INSERT INTO accounting.cost_update(business_id,item_id,cost,source_id) VALUES(%s,%s,%s,%s)', (tenant, str(item_id), cost, str(source_id)))
    raw(session, 'UPDATE public.catalog_items SET cost_price=%s WHERE business_id=%s AND id=%s', (cost, tenant, str(item_id)))


def _stock_in(session, actor, key, item_id, quantity, amount, day, evidence):
    """Puts received goods into stock at their cost and moves the weighted-average cost (or the valuation records)."""
    tenant = str(session.business_id)
    row = raw(session, """SELECT name,stock_quantity,cost_price FROM public.catalog_items WHERE business_id=%s AND id=%s AND is_active
      AND item_type='PRODUCT' AND coalesce((to_jsonb(catalog_items)->>'track_stock')::boolean,true) FOR UPDATE""", (tenant, str(item_id))).first()
    if not row: raise HTTPException(422, 'Only active products whose stock you track can be received')
    on_hand = row.stock_quantity or 0
    if on_hand < 0: raise HTTPException(409, f'{row.name} shows negative stock. Count and correct it before receiving more.')
    valuation = inventory.state(session, item_id)
    if valuation:
        inventory.dated(session, day, valuation)
        if on_hand != valuation.quantity: raise HTTPException(409, 'Stock quantities do not reconcile to valuation')
        inventory.update(session, item_id, valuation.quantity + quantity, valuation.gross_cost + amount, valuation.allowance, max(day, valuation.last_date))
        inventory.event(session, actor, uuid5(key, 'receive:' + str(item_id)), item_id, 'receipt', max(day, valuation.last_date), quantity, amount, ZERO, key, evidence)
    else:
        current = row.cost_price or ZERO
        average = _cost((on_hand * current + amount) / (on_hand + quantity)) if on_hand > 0 else _cost(amount / quantity)
        if average != current: _set_cost(session, item_id, key, average)
    raw(session, 'UPDATE public.catalog_items SET stock_quantity=stock_quantity+%s WHERE business_id=%s AND id=%s', (quantity, tenant, str(item_id)))
    raw(session, 'INSERT INTO accounting.stock_event(business_id,source_id,item_id,quantity,unit_cost) VALUES(%s,%s,%s,%s,%s)',
        (tenant, str(key), str(item_id), quantity, _cost(amount / quantity)))
    return row.name


def _next_number(session, table, prefix):
    last = raw(session, f"SELECT max(substring(number FROM {len(prefix) + 1})::integer) FROM accounting.{table} WHERE business_id=%s AND number ~ %s",
               (str(session.business_id), f'^{prefix}[0-9]+$')).scalar()
    return f'{prefix}{(last or 0) + 1:04d}'


def receive(session, actor, data: GoodsReceive):
    def execute():
        _plan(session)
        tenant = str(session.business_id); day = business_today(session)
        if len({l.item_id for l in data.lines}) != len(data.lines): raise HTTPException(422, 'Each product appears once in a receipt')
        order = None; ordered = {}
        if data.order_id is not None:
            order = raw(session, 'SELECT * FROM public.purchase_orders WHERE business_id=%s AND id=%s FOR UPDATE', (tenant, str(data.order_id))).first()
            if not order: raise HTTPException(404, 'Purchase order not found')
            if order.status not in {'sent', 'partly_received'}:
                raise HTTPException(409, 'Goods are received only against a sent order' if order.status == 'draft' else f'This order is {order.status.replace("_", " ")}')
            if data.supplier_id is not None and str(data.supplier_id) != str(order.supplier_id): raise HTTPException(422, 'This order is for another supplier')
            supplier = order.supplier_id
            ordered = {str(r.item_id): r for r in raw(session, 'SELECT * FROM public.purchase_order_lines WHERE business_id=%s AND order_id=%s FOR UPDATE',
                                                      (tenant, str(order.id))).all()}
        else:
            if data.supplier_id is None: raise HTTPException(422, 'Choose the supplier the goods came from')
            supplier = data.supplier_id
            if not raw(session, 'SELECT 1 FROM public.suppliers WHERE business_id=%s AND id=%s', (tenant, str(supplier))).first():
                raise HTTPException(422, 'Choose one of your suppliers')
        from cacu.accounting import outlets
        outlet = outlets.choose(session, actor, data.location_id, 'Choose the outlet receiving the goods')
        outlets.use(session, outlet)
        grni = _ensure_grni(session, actor)
        total = ZERO; lines = []
        for line in sorted(data.lines, key=lambda l: str(l.item_id)):
            if order is not None:
                planned = ordered.get(str(line.item_id))
                if planned is None: raise HTTPException(422, 'That product is not on this order. Receive it on its own instead.')
                left = planned.quantity - planned.received_quantity
                if line.quantity > left: raise HTTPException(409, f'Only {left} more were ordered' if left else 'All of that product has already been received')
            amount = (Decimal(line.unit_cost) * line.quantity).quantize(CENT, rounding=ROUND_HALF_UP)
            name = _stock_in(session, actor, data.request_key, line.item_id, line.quantity, amount, day, {'supplier_id': str(supplier), 'note': data.note})
            total += amount; lines.append((line, amount, name))
        if total <= 0: raise HTTPException(422, 'A receipt must be worth more than zero')
        number = _next_number(session, 'goods_receipt', 'GR-')
        stock_key = uuid5(data.request_key, 'receipt')
        posting = post_command(session, actor, PostingCommand(request_key=stock_key, source_id=stock_key, kind='adjustment', main_account_id=purpose(session, 'inventory'),
            entry_date=day, credited=False, narration=f'Goods received {number}' + (f' on {order.number}' if order else ''),
            lines=[{'account_id': grni, 'amount': format(total, '.2f'), 'credited': True}]), managed_stock=True)
        raw(session, 'INSERT INTO accounting.inventory_journal(business_id,source_id) VALUES(%s,%s)', (tenant, str(stock_key)))
        raw(session, """INSERT INTO accounting.goods_receipt(business_id,id,number,order_id,supplier_id,received_on,received_by,note,total,posting,location_id)
          VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s)""", (tenant, str(data.request_key), number, str(order.id) if order else None, str(supplier), day,
          str(actor), data.note.strip(), total, json.dumps({'transaction_no': posting.get('transaction_no')}), outlet))
        for line, amount, _ in lines:
            raw(session, 'INSERT INTO accounting.goods_receipt_line(business_id,receipt_id,item_id,quantity,unit_cost,amount) VALUES(%s,%s,%s,%s,%s,%s)',
                (tenant, str(data.request_key), str(line.item_id), line.quantity, _cost(Decimal(line.unit_cost)), amount))
            if order is not None:
                raw(session, 'UPDATE public.purchase_order_lines SET received_quantity=received_quantity+%s WHERE business_id=%s AND order_id=%s AND item_id=%s',
                    (line.quantity, tenant, str(order.id), str(line.item_id)))
        if order is not None:
            left = raw(session, 'SELECT coalesce(sum(quantity-received_quantity),0) FROM public.purchase_order_lines WHERE business_id=%s AND order_id=%s',
                       (tenant, str(order.id))).scalar()
            raw(session, 'UPDATE public.purchase_orders SET status=%s WHERE business_id=%s AND id=%s', ('received' if left <= 0 else 'partly_received', tenant, str(order.id)))
        raw(session, "INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,'goods_received',%s::jsonb)",
            (tenant, str(actor), str(data.request_key), json.dumps({'number': number, 'order_id': str(order.id) if order else None, 'total': _money(total)})))
        return detail(session, data.request_key)
    return durable(session, actor, 'goods_receipt', data, execute)


def _stock_out(session, actor, key, item_id, quantity, amount, day):
    """Takes returned goods back out of stock at the cost they were received at, moving the weighted average back."""
    tenant = str(session.business_id)
    row = raw(session, 'SELECT name,stock_quantity,cost_price FROM public.catalog_items WHERE business_id=%s AND id=%s FOR UPDATE', (tenant, str(item_id))).one()
    on_hand = row.stock_quantity or 0
    if on_hand < quantity: raise HTTPException(409, f'Only {max(on_hand, 0)} x {row.name} in stock to return')
    valuation = inventory.state(session, item_id)
    if valuation:
        inventory.dated(session, day, valuation)
        if on_hand != valuation.quantity: raise HTTPException(409, 'Stock quantities do not reconcile to valuation')
        if valuation.gross_cost < amount: raise HTTPException(409, f'{row.name} is valued below what is being returned. Ask your accountant.')
        inventory.update(session, item_id, valuation.quantity - quantity, valuation.gross_cost - amount, valuation.allowance, max(day, valuation.last_date))
        inventory.event(session, actor, uuid5(key, 'return:' + str(item_id)), item_id, 'adjustment', max(day, valuation.last_date), -quantity, -amount, ZERO, key, {'supplier_return': True})
    else:
        current = row.cost_price or ZERO; left = on_hand - quantity
        average = _cost(max(on_hand * current - amount, ZERO) / left) if left > 0 else current
        if average != current: _set_cost(session, item_id, key, average)
    raw(session, 'UPDATE public.catalog_items SET stock_quantity=stock_quantity-%s WHERE business_id=%s AND id=%s', (quantity, tenant, str(item_id)))
    raw(session, 'INSERT INTO accounting.stock_event(business_id,source_id,item_id,quantity,unit_cost) VALUES(%s,%s,%s,%s,%s)',
        (tenant, str(key), str(item_id), -quantity, _cost(amount / quantity)))


def return_goods(session, actor, receipt_id: UUID, data: SupplierReturn):
    def execute():
        _plan(session)
        tenant = str(session.business_id); key = UUID(str(receipt_id)); day = business_today(session)
        receipt = raw(session, 'SELECT * FROM accounting.goods_receipt WHERE business_id=%s AND id=%s', (tenant, str(key))).first()
        if not receipt: raise HTTPException(404, 'Goods receipt not found')
        if len({l.item_id for l in data.lines}) != len(data.lines): raise HTTPException(422, 'Each product appears once in a return')
        received = {str(r.item_id): r for r in raw(session, 'SELECT * FROM accounting.goods_receipt_line WHERE business_id=%s AND receipt_id=%s FOR UPDATE',
                                                   (tenant, str(key))).all()}
        grni = grni_account(session)
        if grni is None: raise HTTPException(409, 'Goods received not invoiced is archived. Restore it in the chart of accounts.')
        from cacu.accounting import outlets
        outlets.use(session, receipt.location_id)
        total = ZERO; lines = []
        for line in sorted(data.lines, key=lambda l: str(l.item_id)):
            got = received.get(str(line.item_id))
            if got is None: raise HTTPException(422, 'That product is not on this receipt')
            left = got.quantity - got.returned_quantity - got.billed_quantity
            if line.quantity > left: raise HTTPException(409, f'Only {left} can still be returned from this receipt' if left else 'Nothing of that product can still be returned from this receipt')
            amount = (got.unit_cost * line.quantity).quantize(CENT, rounding=ROUND_HALF_UP)
            gap = outlets.short(session, line.item_id, line.quantity)
            if gap: raise HTTPException(409, f'Only {gap[0]} of that product left at {gap[1]} to return')
            _stock_out(session, actor, data.request_key, line.item_id, line.quantity, amount, day)
            total += amount; lines.append((line, amount))
        stock_key = uuid5(data.request_key, 'return')
        posting = None
        if total > 0:
            posting = post_command(session, actor, PostingCommand(request_key=stock_key, source_id=stock_key, kind='adjustment', main_account_id=purpose(session, 'inventory'),
                entry_date=day, credited=True, narration=f'Returned to supplier from {receipt.number}: {data.reason.strip()}',
                lines=[{'account_id': grni, 'amount': format(total, '.2f'), 'credited': False}]), managed_stock=True)
            raw(session, 'INSERT INTO accounting.inventory_journal(business_id,source_id) VALUES(%s,%s)', (tenant, str(stock_key)))
        raw(session, """INSERT INTO accounting.supplier_return(business_id,id,receipt_id,reason,returned_on,returned_by,total,posting)
          VALUES(%s,%s,%s,%s,%s,%s,%s,%s::jsonb)""", (tenant, str(data.request_key), str(key), data.reason.strip(), day, str(actor), total,
          json.dumps({'transaction_no': posting.get('transaction_no') if posting else None})))
        for line, amount in lines:
            raw(session, 'INSERT INTO accounting.supplier_return_line(business_id,return_id,item_id,quantity,amount) VALUES(%s,%s,%s,%s,%s)',
                (tenant, str(data.request_key), str(line.item_id), line.quantity, amount))
            raw(session, 'UPDATE accounting.goods_receipt_line SET returned_quantity=returned_quantity+%s WHERE business_id=%s AND receipt_id=%s AND item_id=%s',
                (line.quantity, tenant, str(key), str(line.item_id)))
        raw(session, "INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,'supplier_return',%s::jsonb)",
            (tenant, str(actor), str(data.request_key), json.dumps({'receipt': receipt.number, 'total': _money(total), 'reason': data.reason.strip()})))
        return detail(session, key)
    return durable(session, actor, 'supplier_return:' + str(receipt_id), data, execute)


RECEIPT_SELECT = """SELECT r.*,s.name AS supplier_name,o.number AS order_number FROM accounting.goods_receipt r
  LEFT JOIN public.suppliers s ON s.business_id=r.business_id AND s.id=r.supplier_id
  LEFT JOIN public.purchase_orders o ON o.business_id=r.business_id AND o.id=r.order_id"""


def _summary(r, session=None):
    from cacu.accounting.outlets import name
    return {'id': str(r.id), 'number': r.number, 'order_id': str(r.order_id) if r.order_id else None, 'order_number': r.order_number,
            'supplier_id': str(r.supplier_id), 'supplier_name': r.supplier_name, 'received_on': r.received_on.isoformat(),
            'location_id': str(r.location_id) if getattr(r, 'location_id', None) else None, 'outlet': name(session, r.location_id) if session is not None and getattr(r, 'location_id', None) else None,
            'total': _money(r.total), 'note': r.note}


def detail(session, receipt_id):
    tenant = str(session.business_id)
    r = raw(session, RECEIPT_SELECT + ' WHERE r.business_id=%s AND r.id=%s', (tenant, str(receipt_id))).first()
    if not r: raise HTTPException(404, 'Goods receipt not found')
    lines = raw(session, """SELECT l.*,c.name FROM accounting.goods_receipt_line l JOIN public.catalog_items c ON c.business_id=l.business_id AND c.id=l.item_id
      WHERE l.business_id=%s AND l.receipt_id=%s ORDER BY c.name""", (tenant, str(receipt_id))).all()
    returns = raw(session, 'SELECT id,reason,returned_on,total FROM accounting.supplier_return WHERE business_id=%s AND receipt_id=%s ORDER BY returned_at',
                  (tenant, str(receipt_id))).all()
    return {**_summary(r, session), 'lines': [{'item_id': str(l.item_id), 'name': l.name, 'quantity': l.quantity, 'unit_cost': format(l.unit_cost, '.4f'),
                                      'amount': _money(l.amount), 'returned_quantity': l.returned_quantity, 'billed_quantity': l.billed_quantity,
                                      'returnable': l.quantity - l.returned_quantity - l.billed_quantity} for l in lines],
            'returns': [{'id': str(x.id), 'reason': x.reason, 'returned_on': x.returned_on.isoformat(), 'total': _money(x.total)} for x in returns]}


def list_receipts(session, order_id: UUID | None = None, limit=200):
    tenant = str(session.business_id)
    if order_id is not None:
        rows = raw(session, RECEIPT_SELECT + ' WHERE r.business_id=%s AND r.order_id=%s ORDER BY r.received_at DESC', (tenant, str(order_id))).all()
    else:
        rows = raw(session, RECEIPT_SELECT + ' WHERE r.business_id=%s ORDER BY r.received_at DESC LIMIT %s', (tenant, limit)).all()
    return [_summary(r, session) for r in rows]


# Bills for received goods (part 3) ------------------------------------------------------------------------------------

class BilledLine(BaseModel):
    model_config = ConfigDict(extra='forbid')
    receipt_id: UUID
    item_id: UUID
    quantity: int = Field(gt=0, le=1000000)
    amount: str = Field(pattern=r'^[0-9]{1,13}(\.[0-9]{1,2})?$')


class GoodsBill(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: UUID
    supplier_id: UUID
    bill_number: str = Field(min_length=1, max_length=100)
    entry_date: date
    due_date: date | None = None
    notes: str = Field(default='', max_length=1000)
    lines: list[BilledLine] = Field(min_length=1, max_length=100)


def _difference(session, actor, key, item_id, quantity, difference, day):
    """IAS 2: a bill's difference from the received cost goes into the cost of units still in stock; the share for units
    already sold goes to cost of sales. Returns (to stock, to cost of sales)."""
    tenant = str(session.business_id)
    row = raw(session, 'SELECT stock_quantity,cost_price FROM public.catalog_items WHERE business_id=%s AND id=%s FOR UPDATE', (tenant, str(item_id))).one()
    on_hand = max(row.stock_quantity or 0, 0)
    in_stock = (difference * min(quantity, on_hand) / quantity).quantize(CENT, rounding=ROUND_HALF_UP)
    if in_stock:
        valuation = inventory.state(session, item_id)
        if valuation:
            inventory.dated(session, day, valuation)
            if valuation.gross_cost + in_stock < 0: raise HTTPException(409, 'This bill would take the stock value below zero. Ask your accountant.')
            inventory.update(session, item_id, valuation.quantity, valuation.gross_cost + in_stock, valuation.allowance, max(day, valuation.last_date))
            inventory.event(session, actor, uuid5(key, 'bill:' + str(item_id)), item_id, 'adjustment', max(day, valuation.last_date), 0, in_stock, ZERO, key, {'supplier_bill': True})
        else:
            average = _cost(max(on_hand * (row.cost_price or ZERO) + in_stock, ZERO) / on_hand)
            if average != (row.cost_price or ZERO): _set_cost(session, item_id, key, average)
    return in_stock, difference - in_stock


def bill_received(session, actor, data: GoodsBill):
    """The supplier's bill for goods already received (PR-18): Dr Goods received not invoiced, Cr Payables."""
    def execute():
        from cacu.accounting.bills import _writer
        from cacu.accounting.workflows import party_account
        _plan(session); _writer(session, actor)
        tenant = str(session.business_id); number = data.bill_number.strip(); day = data.entry_date
        if not number: raise HTTPException(422, "Enter the supplier's bill number")
        if day > business_today(session): raise HTTPException(422, 'A bill cannot be dated in the future')
        if data.due_date and data.due_date < day: raise HTTPException(422, 'The due date cannot be before the bill date')
        if len({(l.receipt_id, l.item_id) for l in data.lines}) != len(data.lines): raise HTTPException(422, 'Each received product appears once on a bill')
        if raw(session, 'SELECT 1 FROM accounting.supplier_bill WHERE business_id=%s AND supplier_id=%s AND lower(btrim(bill_number))=lower(%s)',
               (tenant, str(data.supplier_id), number)).first():
            raise HTTPException(409, "This supplier's bill with that number is already recorded")
        grni = grni_account(session)
        if grni is None: raise HTTPException(409, 'Nothing has been received yet to bill')
        received = ZERO; billed = ZERO; matched = []
        for line in sorted(data.lines, key=lambda l: (str(l.receipt_id), str(l.item_id))):
            got = raw(session, """SELECT l.*,r.supplier_id,r.received_on,r.number FROM accounting.goods_receipt_line l
              JOIN accounting.goods_receipt r ON r.business_id=l.business_id AND r.id=l.receipt_id
              WHERE l.business_id=%s AND l.receipt_id=%s AND l.item_id=%s FOR UPDATE OF l""", (tenant, str(line.receipt_id), str(line.item_id))).first()
            if not got: raise HTTPException(422, 'That product is not on that goods receipt')
            if str(got.supplier_id) != str(data.supplier_id): raise HTTPException(422, f'{got.number} is from another supplier')
            if got.received_on > day: raise HTTPException(422, f'A bill cannot be dated before its goods were received ({got.number})')
            left = got.quantity - got.returned_quantity - got.billed_quantity
            if line.quantity > left:
                raise HTTPException(409, f'Only {left} can still be billed on {got.number}' if left else f'That product on {got.number} has already been billed or returned')
            value = (got.unit_cost * line.quantity).quantize(CENT, rounding=ROUND_HALF_UP)
            matched.append((line, got, value, Decimal(line.amount)))
            received += value; billed += Decimal(line.amount)
        if billed <= 0: raise HTTPException(422, 'A bill must be for more than zero')
        payables = party_account(session, 'suppliers', data.supplier_id)
        raw(session, 'INSERT INTO accounting.supplier_bill(business_id,id,supplier_id,bill_number,bill_date,due_date,notes,created_by) VALUES(%s,%s,%s,%s,%s,%s,%s,%s)',
            (tenant, str(data.request_key), str(data.supplier_id), number, day, data.due_date, data.notes, str(actor)))
        posting = post_command(session, actor, PostingCommand(request_key=uuid5(data.request_key, 'posting'), kind='goods_bill', source_id=data.request_key,
            main_account_id=payables, counterparty_id=data.supplier_id, entry_date=day, credited=True, narration=f'Bill {number}',
            lines=[{'account_id': grni, 'amount': format(billed, '.2f'), 'credited': False}]), internal=True)
        to_stock = to_sales = ZERO
        for line, got, value, amount in matched:
            difference = amount - value
            in_stock, in_sales = _difference(session, actor, data.request_key, line.item_id, line.quantity, difference, day) if difference else (ZERO, ZERO)
            if difference:
                # Clear Goods received not invoiced at the received cost; the difference goes to stock and cost of sales.
                key = uuid5(data.request_key, f'difference:{line.receipt_id}:{line.item_id}')
                rise = difference > 0
                lines = [{'account_id': purpose(session, 'inventory'), 'amount': format(abs(in_stock), '.2f'), 'credited': not rise}] if in_stock else []
                if in_sales: lines.append({'account_id': purpose(session, 'cogs'), 'amount': format(abs(in_sales), '.2f'), 'credited': not rise})
                post_command(session, actor, PostingCommand(request_key=key, source_id=key, kind='adjustment', main_account_id=grni, entry_date=day,
                    credited=rise, narration=f'Bill {number}: price difference on {got.number}', lines=lines), managed_stock=True)
                raw(session, 'INSERT INTO accounting.inventory_journal(business_id,source_id) VALUES(%s,%s)', (tenant, str(key)))
            raw(session, """INSERT INTO accounting.supplier_bill_receipt(business_id,bill_id,receipt_id,item_id,quantity,received_value,billed_amount,to_stock,to_cost_of_sales)
              VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)""", (tenant, str(data.request_key), str(line.receipt_id), str(line.item_id), line.quantity, value, amount, in_stock, in_sales))
            raw(session, 'UPDATE accounting.goods_receipt_line SET billed_quantity=billed_quantity+%s WHERE business_id=%s AND receipt_id=%s AND item_id=%s',
                (line.quantity, tenant, str(line.receipt_id), str(line.item_id)))
            to_stock += in_stock; to_sales += in_sales
        raw(session, "INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,'goods_billed',%s::jsonb)",
            (tenant, str(actor), str(data.request_key), json.dumps({'bill': number, 'billed': _money(billed), 'received': _money(received)})))
        return {'id': str(data.request_key), 'bill_number': number, 'total': _money(billed), 'received_value': _money(received),
                'difference_to_stock': _money(to_stock), 'difference_to_cost_of_sales': _money(to_sales), 'posting': posting}
    return durable(session, actor, 'goods_bill', data, execute)
