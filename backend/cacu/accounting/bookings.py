"""Booking deposits (Doc 10 services rules, Doc 09 PR-12), part 2 of bookings.

The owner sets a deposit per service (fixed, or a percentage of the price), the free-cancellation window and what a
late cancellation or no-show does with the deposit (kept as income by default, or refunded). A deposit is taken on a
confirmed or checked-in booking: cash goes into the till, a transfer waits in Transfers awaiting confirmation (BR-010);
both are held in Customer deposits and advances. Cancelling inside the window refunds it; a late cancellation or
no-show follows the owner's rule, and choosing the other outcome needs sales.approve. A booking holding a deposit is
cancelled or marked no-show only here, so the booking and its deposit settle together. Every write is replay-safe."""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
import json
from typing import Literal
from uuid import NAMESPACE_URL, UUID, uuid5
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from cacu.accounting.posting import PostingCommand, post_command, raw
from cacu.accounting.session import allowed
from cacu.accounting.workflows import business_today, clearing_account, collection_account, durable, purpose

AMOUNT = r'^[0-9]{1,13}(\.[0-9]{1,2})?$'
OPEN = ('awaiting_transfer', 'held')
DEPOSITS_NAME = 'Customer deposits and advances'


class DepositRule(BaseModel):
    model_config = ConfigDict(extra='forbid')
    service_id: UUID
    kind: Literal['none', 'fixed', 'percent']
    value: str = Field(default='0', pattern=AMOUNT)


class BookingSettings(BaseModel):
    model_config = ConfigDict(extra='forbid')
    free_cancel_hours: int = Field(ge=0, le=720)
    late_deposit: Literal['keep', 'refund']
    rules: list[DepositRule] = Field(default_factory=list, max_length=500)


class DepositTake(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: UUID
    amount: str = Field(pattern=AMOUNT)
    method: Literal['Cash', 'Transfer']
    bank_account_id: UUID | None = None


class BookingClose(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: UUID
    reason: str = Field(default='', max_length=500)
    deposit: Literal['keep', 'refund'] | None = None
    bank_account_id: UUID | None = None


def _money(value):
    return format(value, '.2f') if value is not None else None


def deposits_account(session):
    row = raw(session, "SELECT m.account_id FROM accounting.account_map m JOIN public.accounts a ON a.id=m.account_id AND a.business_id=m.business_id "
              "WHERE m.business_id=%s AND m.purpose='customer_deposits' AND a.is_active", (str(session.business_id),)).first()
    return row.account_id if row else None


def policy(session):
    row = raw(session, 'SELECT free_cancel_hours,late_deposit FROM accounting.booking_policy WHERE business_id=%s', (str(session.business_id),)).first()
    return {'free_cancel_hours': row.free_cancel_hours if row else 24, 'late_deposit': row.late_deposit if row else 'keep'}


def settings(session):
    """The owner's booking rules, each service's deposit, and whether deposits can be taken yet."""
    rules = raw(session, 'SELECT service_id,kind,value FROM accounting.service_deposit_rule WHERE business_id=%s ORDER BY service_id',
                (str(session.business_id),)).all()
    return {**policy(session), 'deposits_ready': deposits_account(session) is not None,
            'rules': [{'service_id': str(r.service_id), 'kind': r.kind, 'value': _money(r.value)} for r in rules]}


def save_settings(session, actor, data: BookingSettings):
    tenant = str(session.business_id)
    if len({r.service_id for r in data.rules}) != len(data.rules): raise HTTPException(422, 'Each service appears once')
    services = {str(r.id) for r in raw(session, "SELECT id FROM public.catalog_items WHERE business_id=%s AND item_type='SERVICE'", (tenant,)).all()}
    for rule in data.rules:
        if str(rule.service_id) not in services: raise HTTPException(422, 'Deposits are set on your own services')
        if rule.kind != 'none' and Decimal(rule.value) <= 0: raise HTTPException(422, 'Enter a deposit above zero')
        if rule.kind == 'percent' and Decimal(rule.value) > 100: raise HTTPException(422, 'A deposit can be at most 100% of the price')
    if any(r.kind != 'none' for r in data.rules) and deposits_account(session) is None:
        # The first deposit adds Customer deposits and advances to the chart (owner or admin only).
        from cacu.accounting.accounts import add_account
        add_account(session, actor, uuid5(NAMESPACE_URL, f'cacu:customer-deposits:{tenant}'), 'customer_deposits', DEPOSITS_NAME)
    raw(session, """INSERT INTO accounting.booking_policy(business_id,free_cancel_hours,late_deposit,updated_by) VALUES(%s,%s,%s,%s)
      ON CONFLICT (business_id) DO UPDATE SET free_cancel_hours=EXCLUDED.free_cancel_hours,late_deposit=EXCLUDED.late_deposit,
      updated_by=EXCLUDED.updated_by,updated_at=now()""", (tenant, data.free_cancel_hours, data.late_deposit, str(actor)))
    for rule in data.rules:
        if rule.kind == 'none':
            raw(session, 'DELETE FROM accounting.service_deposit_rule WHERE business_id=%s AND service_id=%s', (tenant, str(rule.service_id)))
        else:
            raw(session, """INSERT INTO accounting.service_deposit_rule(business_id,service_id,kind,value,updated_by) VALUES(%s,%s,%s,%s,%s)
              ON CONFLICT (business_id,service_id) DO UPDATE SET kind=EXCLUDED.kind,value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()""",
                (tenant, str(rule.service_id), rule.kind, Decimal(rule.value), str(actor)))
    result = settings(session)
    raw(session, "INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,gen_random_uuid(),'booking_settings',%s::jsonb)",
        (tenant, str(actor), json.dumps(result)))
    return result


def expected(kind, value, price):
    """The deposit a service asks for: a fixed amount (never more than the price) or a percentage, rounded half up."""
    if kind == 'fixed': return min(Decimal(value), Decimal(price))
    return (Decimal(price) * Decimal(value) / 100).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def _booking(session, appointment_id, lock=False):
    row = raw(session, f"""SELECT a.id,a.status,a.scheduled_at,a.customer_id,a.customer_name,a.service_id,c.unit_price,c.name AS service
      FROM public.appointments a LEFT JOIN public.catalog_items c ON c.business_id=a.business_id AND c.id=a.service_id
      WHERE a.business_id=%s AND a.id=%s{' FOR UPDATE OF a' if lock else ''}""", (str(session.business_id), str(appointment_id))).first()
    if not row: raise HTTPException(404, 'Booking not found')
    return row


def _open_deposit(session, appointment_id, lock=False):
    return raw(session, f"SELECT * FROM accounting.booking_deposit WHERE business_id=%s AND appointment_id=%s AND status IN ('awaiting_transfer','held'){' FOR UPDATE' if lock else ''}",
               (str(session.business_id), str(appointment_id))).first()


def _audit(session, actor, key, event, details):
    raw(session, 'INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,%s,%s::jsonb)',
        (str(session.business_id), str(actor), str(key), event, json.dumps(details)))


def take(session, actor, appointment_id: UUID, data: DepositTake):
    """PR-12: a deposit on a confirmed or checked-in booking, held in Customer deposits and advances."""
    def execute():
        tenant = str(session.business_id); booking_id = UUID(str(appointment_id))
        booking = _booking(session, booking_id, lock=True)
        if booking.status not in {'confirmed', 'checked_in'}: raise HTTPException(409, 'A deposit is taken only on a confirmed or checked-in booking')
        if _open_deposit(session, booking_id): raise HTTPException(409, 'This booking already has a deposit')
        account = deposits_account(session)
        if account is None: raise HTTPException(409, 'Deposits are not set up yet. Ask the owner to set a deposit on a service in Booking settings.')
        amount = Decimal(data.amount)
        if amount <= 0: raise HTTPException(422, 'Enter a deposit above zero')
        if booking.unit_price is not None and amount > booking.unit_price: raise HTTPException(422, 'A deposit cannot be more than the service price')
        day = business_today(session)
        if data.method == 'Cash':
            if data.bank_account_id is not None: raise HTTPException(422, 'Cash deposits go into the till, not a bank account')
            main = collection_account(session, 'Cash', None); status = 'held'
        else:
            # BR-010: the transfer waits for confirmation; a bank named here is only the one expected.
            if data.bank_account_id is not None: collection_account(session, 'Transfer', data.bank_account_id)
            main = clearing_account(session); status = 'awaiting_transfer'
        who = booking.customer_name or 'customer'
        posting = post_command(session, actor, PostingCommand(request_key=uuid5(data.request_key, 'posting'), kind='booking_deposit', source_id=data.request_key,
            main_account_id=main, entry_date=day, credited=False, narration=f'Deposit for {booking.service or "a booking"} ({who})',
            lines=[{'account_id': account, 'amount': data.amount, 'credited': True}]), internal=True)
        raw(session, """INSERT INTO accounting.booking_deposit(business_id,id,appointment_id,amount,method,status,received_by,received_on,posting)
          VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb)""", (tenant, str(data.request_key), str(booking_id), amount, data.method.lower(), status, str(actor), day,
          json.dumps({'transaction_no': posting.get('transaction_no')})))
        if data.method == 'Transfer':
            raw(session, """INSERT INTO accounting.pending_transfer(business_id,id,source_type,amount,entry_date,customer_id,expected_bank_account_id,created_by)
              VALUES(%s,%s,'deposit',%s,%s,%s,%s,%s)""", (tenant, str(data.request_key), amount, day, str(booking.customer_id) if booking.customer_id else None,
              str(data.bank_account_id) if data.bank_account_id else None, str(actor)))
        else:
            from cacu.accounting.shifts import tag
            tag(session, [actor], 'deposit', data.request_key, amount)
        _audit(session, actor, data.request_key, 'deposit_taken', {'appointment_id': str(booking_id), 'amount': data.amount, 'method': data.method})
        return _deposit(session, data.request_key)
    return durable(session, actor, 'booking_deposit:' + str(appointment_id), data, execute)


def _income(session):
    rows = raw(session, "SELECT account_id FROM accounting.account_map WHERE business_id=%s AND purpose='service_revenue'", (str(session.business_id),)).all()
    return rows[0].account_id if len(rows) == 1 else purpose(session, 'revenue')


def _settle(session, actor, deposit, key, outcome, bank, note):
    """Refunds a held deposit to the till or a bank, or keeps it as income; returns what was done."""
    day = business_today(session); amount = format(deposit.amount, '.2f'); account = deposits_account(session)
    if account is None: raise HTTPException(409, 'Customer deposits and advances is archived. Restore it in the chart of accounts.')
    if outcome == 'refund':
        if deposit.method == 'cash':
            if bank is not None: raise HTTPException(422, 'A cash deposit is refunded from the till')
            paid_from = collection_account(session, 'Cash', None)
        else:
            paid_from = collection_account(session, 'Transfer', bank or deposit.bank_account_id)
        posting = post_command(session, actor, PostingCommand(request_key=uuid5(key, 'deposit'), kind='deposit_settlement', source_id=deposit.id,
            main_account_id=paid_from, entry_date=day, credited=True, narration='Deposit refunded: ' + note,
            lines=[{'account_id': account, 'amount': amount, 'credited': False}]), internal=True)
        status = 'refunded'
        if deposit.method == 'cash':
            from cacu.accounting.shifts import tag
            tag(session, [actor], 'deposit_refund', deposit.id, -deposit.amount)
    else:
        posting = post_command(session, actor, PostingCommand(request_key=uuid5(key, 'deposit'), kind='deposit_settlement', source_id=deposit.id,
            main_account_id=account, entry_date=day, credited=False, narration='Deposit kept: ' + note,
            lines=[{'account_id': _income(session), 'amount': amount, 'credited': True}]), internal=True)
        status = 'forfeited'
    raw(session, """UPDATE accounting.booking_deposit SET status=%s,settled_by=%s,settled_at=now(),settled_on=%s,settle_note=%s,settlement=%s::jsonb
      WHERE business_id=%s AND id=%s""", (status, str(actor), day, note or None, json.dumps({'transaction_no': posting.get('transaction_no')}),
      str(session.business_id), str(deposit.id)))
    return status


def _close(session, actor, appointment_id, data: BookingClose, status):
    def execute():
        booking_id = UUID(str(appointment_id)); booking = _booking(session, booking_id, lock=True)
        if booking.status != 'confirmed':
            raise HTTPException(409, 'Only a confirmed booking can be cancelled or marked no-show')
        reason = data.reason.strip()
        if status == 'cancelled' and len(reason) < 3: raise HTTPException(422, 'Say why the booking is cancelled')
        if status == 'no_show' and datetime.now(timezone.utc) < booking.scheduled_at:
            raise HTTPException(409, 'A booking can be marked no-show only after its start time')
        deposit = _open_deposit(session, booking_id, lock=True); outcome = None
        if deposit and deposit.status == 'awaiting_transfer':
            raise HTTPException(409, "This booking's deposit transfer is still awaiting confirmation. Confirm it or mark it not received on Daily reconciliation first.")
        if deposit:
            rules = policy(session)
            free = status == 'cancelled' and datetime.now(timezone.utc) <= booking.scheduled_at - timedelta(hours=rules['free_cancel_hours'])
            outcome = 'refund' if free else (data.deposit or rules['late_deposit'])
            if not free and outcome != rules['late_deposit'] and not allowed(session, 'sales.approve'):
                raise HTTPException(403, 'Only someone who can approve sales (Owner, Admin or Sales manager) can go against the deposit rule')
            if free and data.deposit == 'keep': raise HTTPException(422, 'Cancelled in time: the deposit is refunded')
            _settle(session, actor, deposit, data.request_key, outcome, data.bank_account_id,
                    reason or ('No-show' if status == 'no_show' else 'Cancelled'))
        elif data.deposit is not None or data.bank_account_id is not None:
            raise HTTPException(422, 'This booking has no deposit')
        raw(session, 'UPDATE public.appointments SET status=%s,cancel_reason=%s WHERE business_id=%s AND id=%s',
            (status, reason if status == 'cancelled' else None, str(session.business_id), str(booking_id)))
        _audit(session, actor, data.request_key, 'booking_' + status, {'appointment_id': str(booking_id), 'deposit': outcome})
        return {'id': str(booking_id), 'status': status, 'deposit': outcome,
                'deposit_amount': _money(deposit.amount) if deposit else None}
    return durable(session, actor, f'booking_{status}:' + str(appointment_id), data, execute)


def cancel(session, actor, appointment_id: UUID, data: BookingClose):
    return _close(session, actor, appointment_id, data, 'cancelled')


def no_show(session, actor, appointment_id: UUID, data: BookingClose):
    return _close(session, actor, appointment_id, data, 'no_show')


DEPOSIT_SELECT = """SELECT d.*,a.customer_name,a.scheduled_at FROM accounting.booking_deposit d
  JOIN public.appointments a ON a.business_id=d.business_id AND a.id=d.appointment_id"""


def _row(r):
    return {'id': str(r.id), 'appointment_id': str(r.appointment_id), 'amount': _money(r.amount), 'method': r.method, 'status': r.status,
            'received_on': r.received_on.isoformat(), 'settled_on': r.settled_on.isoformat() if r.settled_on else None,
            'bank_account_id': str(r.bank_account_id) if r.bank_account_id else None}


def _deposit(session, deposit_id):
    return _row(raw(session, DEPOSIT_SELECT + ' WHERE d.business_id=%s AND d.id=%s', (str(session.business_id), str(deposit_id))).one())


def deposits_between(session, start: date, end: date):
    """Deposits on bookings that start in a range of Lagos days, newest first per booking."""
    rows = raw(session, DEPOSIT_SELECT + """ WHERE d.business_id=%s AND (a.scheduled_at AT TIME ZONE 'Africa/Lagos')::date BETWEEN %s AND %s
      ORDER BY d.received_at DESC LIMIT 1000""", (str(session.business_id), start, end)).all()
    return [_row(r) for r in rows]


def deposit_confirmed(session, transfer_id, bank, actor, day):
    """Daily reconciliation confirmed a deposit transfer: the money moves to the bank (PR-04) and the deposit is held."""
    transfer_id = UUID(str(transfer_id))
    posting = post_command(session, actor, PostingCommand(request_key=uuid5(transfer_id, 'confirm'), kind='transfer_confirmation', source_id=uuid5(transfer_id, 'confirm'),
        main_account_id=bank, entry_date=day, credited=False, narration='Deposit transfer received',
        lines=[{'account_id': clearing_account(session), 'amount': format(_awaiting(session, transfer_id).amount, '.2f'), 'credited': True}]), internal=True)
    raw(session, "UPDATE accounting.booking_deposit SET status='held',bank_account_id=%s WHERE business_id=%s AND id=%s",
        (str(bank), str(session.business_id), str(transfer_id)))
    return posting


def deposit_not_received(session, transfer_id, actor, day, note):
    """The deposit transfer never arrived: the deposit is taken back out of Customer deposits."""
    transfer_id = UUID(str(transfer_id))
    deposit = _awaiting(session, transfer_id)
    posting = post_command(session, actor, PostingCommand(request_key=uuid5(transfer_id, 'not-received'), kind='transfer_not_received',
        source_id=uuid5(transfer_id, 'not-received'), main_account_id=clearing_account(session), entry_date=day, credited=True,
        narration='Deposit transfer not received: ' + note,
        lines=[{'account_id': deposits_account(session), 'amount': format(deposit.amount, '.2f'), 'credited': False}]), internal=True)
    raw(session, "UPDATE accounting.booking_deposit SET status='not_received',settled_by=%s,settled_at=now(),settled_on=%s,settle_note=%s WHERE business_id=%s AND id=%s",
        (str(actor), day, note, str(session.business_id), str(transfer_id)))
    return posting


def _awaiting(session, transfer_id):
    row = raw(session, "SELECT * FROM accounting.booking_deposit WHERE business_id=%s AND id=%s AND status='awaiting_transfer' FOR UPDATE",
              (str(session.business_id), str(transfer_id))).first()
    if not row: raise HTTPException(409, 'This deposit is no longer waiting for its transfer')
    return row


# Billing a completed booking (part 3, PR-13 and PR-11) -----------------------------------------------------------------

class BookingInvoice(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: UUID
    customer_id: UUID | None = None


def bill_info(session, appointment_id: UUID):
    """What the till or an invoice needs to bill a booking: the service, its price, and any deposit to apply."""
    booking = _booking(session, appointment_id)
    extra = raw(session, 'SELECT bill_kind,bill_id FROM public.appointments WHERE business_id=%s AND id=%s',
                (str(session.business_id), str(appointment_id))).one()
    deposit = _open_deposit(session, appointment_id)
    return {'id': str(booking.id), 'status': booking.status, 'customer_id': str(booking.customer_id) if booking.customer_id else None,
            'customer_name': booking.customer_name, 'service_id': str(booking.service_id), 'service': booking.service,
            'price': _money(booking.unit_price), 'bill_kind': extra.bill_kind, 'bill_id': str(extra.bill_id) if extra.bill_id else None,
            'deposit': {'amount': _money(deposit.amount), 'method': deposit.method, 'status': deposit.status} if deposit else None}


def billable(session, appointment_id):
    """Locks a completed, unbilled booking and returns it with its held deposit (or None)."""
    booking = _booking(session, appointment_id, lock=True)
    billed = raw(session, 'SELECT bill_kind FROM public.appointments WHERE business_id=%s AND id=%s',
                 (str(session.business_id), str(appointment_id))).scalar()
    if booking.status != 'completed': raise HTTPException(409, 'Complete the booking before billing it')
    if billed: raise HTTPException(409, 'This booking has already been billed')
    deposit = _open_deposit(session, appointment_id, lock=True)
    if deposit and deposit.status == 'awaiting_transfer':
        raise HTTPException(409, "This booking's deposit transfer is still awaiting confirmation. Confirm it on Daily reconciliation first.")
    return booking, deposit


def mark_billed(session, appointment_id, kind, bill_id, deposit, actor, settlement):
    tenant = str(session.business_id)
    raw(session, 'UPDATE public.appointments SET bill_kind=%s,bill_id=%s,billed_at=now() WHERE business_id=%s AND id=%s',
        (kind, str(bill_id), tenant, str(appointment_id)))
    if deposit:
        raw(session, """UPDATE accounting.booking_deposit SET status='applied',settled_by=%s,settled_at=now(),settled_on=%s,settle_note=%s,settlement=%s::jsonb
          WHERE business_id=%s AND id=%s""", (str(actor), business_today(session), f'Applied to the {"sale" if kind == "sale" else "invoice"}',
          json.dumps(settlement), tenant, str(deposit.id)))


def apply_at_till(session, actor, appointment_id, deposit, sale_id, method, day):
    """PR-13 at the till: the deposit leaves Customer deposits against the till or Transfers awaiting confirmation the
    full-price sale went into, so the customer pays only the rest."""
    into = collection_account(session, 'Cash', None) if method == 'Cash' else clearing_account(session)
    posting = post_command(session, actor, PostingCommand(request_key=uuid5(sale_id, 'deposit'), kind='deposit_application', source_id=sale_id,
        main_account_id=deposits_account(session), entry_date=day, credited=False, narration='Booking deposit applied to the sale',
        lines=[{'account_id': into, 'amount': format(deposit.amount, '.2f'), 'credited': True}]), internal=True)
    if method == 'Cash':
        from cacu.accounting.shifts import tag
        tag(session, [actor], 'deposit_applied', sale_id, -deposit.amount)
    mark_billed(session, appointment_id, 'sale', sale_id, deposit, actor, {'transaction_no': posting.get('transaction_no'), 'sale_id': str(sale_id)})


def bill_invoice(session, actor, appointment_id: UUID, data: BookingInvoice):
    """Issues an invoice for a completed booking to its customer and applies any held deposit to it (PR-11)."""
    def execute():
        from cacu.accounting.workflows import InvoiceCreate, invoice_create, invoice_outstanding, party_account
        booking_id = UUID(str(appointment_id)); booking, deposit = billable(session, booking_id)
        customer = booking.customer_id or data.customer_id
        if customer is None: raise HTTPException(422, 'Choose the customer to invoice')
        if booking.customer_id and data.customer_id and str(data.customer_id) != str(booking.customer_id):
            raise HTTPException(422, 'This booking is for another customer')
        if booking.unit_price is None or booking.unit_price <= 0: raise HTTPException(409, 'The booked service has no price to invoice')
        day = business_today(session)
        invoice = invoice_create(session, actor, InvoiceCreate(request_key=uuid5(data.request_key, 'invoice'), customer_id=customer,
            invoice_number='BK-' + str(data.request_key)[:8].upper(), entry_date=day,
            items=[{'catalog_item_id': booking.service_id, 'quantity': 1, 'unit_price': format(booking.unit_price, '.2f')}]))
        settlement = {'invoice_id': invoice['id']}
        if deposit:
            posting = post_command(session, actor, PostingCommand(request_key=uuid5(data.request_key, 'deposit'), kind='deposit_application',
                source_id=data.request_key, target_id=UUID(invoice['id']), main_account_id=party_account(session, 'customers', customer),
                entry_date=day, credited=True, narration='Booking deposit applied to invoice ' + 'BK-' + str(data.request_key)[:8].upper(),
                lines=[{'account_id': deposits_account(session), 'amount': format(deposit.amount, '.2f'), 'credited': False}]), internal=True)
            settlement['transaction_no'] = posting.get('transaction_no')
        mark_billed(session, booking_id, 'invoice', invoice['id'], deposit, actor, settlement)
        _audit(session, actor, data.request_key, 'booking_invoiced', {'appointment_id': str(booking_id), 'invoice_id': invoice['id'],
               'deposit_applied': _money(deposit.amount) if deposit else '0.00'})
        return {'appointment_id': str(booking_id), 'invoice_id': invoice['id'], 'invoice_number': 'BK-' + str(data.request_key)[:8].upper(),
                'total': _money(booking.unit_price), 'deposit_applied': _money(deposit.amount) if deposit else '0.00',
                'outstanding': format(invoice_outstanding(session, invoice['id'])[0], '.2f')}
    return durable(session, actor, 'booking_invoice:' + str(appointment_id), data, execute)
