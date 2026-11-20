"""Online invoice payments through the business's own Paystack account (Doc 10 E23, FR-220 to FR-223; Doc 09 PR-14,
PR-15; Doc 11; BR-010).

* An Owner or Admin connects the business's Paystack secret key and names the bank Paystack pays out to. The key is
  sealed (cacu.payments.keys) before it reaches the database, and is never shown again.
* Staff share a pay link for an issued invoice. The customer chooses how much to pay (up to what is still owed) and
  pays on Paystack's page. Nothing posts until Paystack's verify endpoint says the payment succeeded, whichever way
  the news arrives: the customer's return, the webhook or the check job.
* A verified payment debits Card and online payments clearing (1030) and credits the customer's receivable, allocated
  to the invoice (PR-14). Anything paid beyond what is still owed is kept as the customer's advance (PR-10).
* A Paystack settlement debits the payout bank with the net amount and Bank and payment charges (6400) with the fee,
  and credits clearing with the gross (PR-15). A settlement holding money CACU did not take, or whose total does not
  match, is posted for the payments CACU knows and held for review for the rest.
"""
import json
import re
import secrets
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from uuid import UUID, NAMESPACE_URL, uuid4, uuid5
from zoneinfo import ZoneInfo
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from python_accounting.models import Transaction
from cacu.accounting.posting import PostingCommand, post_command, raw
from cacu.accounting.workflows import bank_accounts, business_today, collection_account, invoice_outstanding, role
from cacu.payments import keys

MONEY = r'^[0-9]{1,13}(\.[0-9]{1,2})?$'
REFERENCE = re.compile(r'^CACU-PAY-[0-9a-f]{32}$')
TOKEN = re.compile(r'^[0-9a-f]{64}$')
EMAIL = re.compile(r'^[^@\s<>"]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$')
CLEARING_NAME = 'Card and online payments clearing'
ZERO = Decimal('0')
MINIMUM = Decimal('100')
PENDING_PER_HOUR = 10


class PaystackConnect(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: UUID
    secret_key: str = Field(min_length=20, max_length=120, repr=False)
    settlement_bank_account_id: UUID


class LinkCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: UUID


class PayStart(BaseModel):
    model_config = ConfigDict(extra='forbid')
    amount: str = Field(pattern=MONEY)
    email: str | None = Field(default=None, max_length=254)


class PayReturn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    reference: str = Field(pattern=r'^CACU-PAY-[0-9a-f]{32}$')


def _money(value):
    return format(Decimal(value), '.2f')


def _owner_or_admin(session, actor, message='Only an Owner or Admin can connect or change online payments'):
    if role(session, actor) not in {'owner', 'admin'}:
        raise HTTPException(403, message)


def _audit(session, actor, key, event, details):
    raw(session, 'INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,%s,%s::jsonb)',
        (str(session.business_id), str(actor), str(key), event, json.dumps(details)))


def _purpose(session, name):
    rows = raw(session, 'SELECT account_id FROM accounting.account_map WHERE business_id=%s AND purpose=%s',
               (str(session.business_id), name)).all()
    return rows[0].account_id if len(rows) == 1 else None


def provider(session):
    return raw(session, 'SELECT * FROM accounting.payment_provider WHERE business_id=%s AND disconnected_at IS NULL',
               (str(session.business_id),)).first()


def secret(session):
    row = provider(session)
    if not row:
        raise HTTPException(409, 'This business has not connected Paystack yet.')
    return keys.unseal(session.business_id, row.secret_ciphertext)


# ---- Settings (Owner or Admin) -------------------------------------------------------------------------------------

def settings(session, actor):
    row = provider(session)
    manager = role(session, actor) in {'owner', 'admin'}
    result = {'connected': bool(row), 'can_manage': manager, 'banks': bank_accounts(session) if manager else []}
    if row:
        result.update({'mode': row.mode, 'key_hint': row.key_hint, 'settlement_bank_account_id': str(row.settlement_bank_account_id),
                       'connected_at': row.connected_at.isoformat()})
        if manager:
            # The owner pastes this address into Paystack (Settings, API keys and webhooks).
            result['webhook_token'] = row.webhook_token
    return result


def connect(session, actor, data: PaystackConnect, mode: str):
    """Saves a key already accepted by Paystack (the route checks it first, outside the transaction)."""
    _owner_or_admin(session, actor)
    tenant = str(session.business_id)
    collection_account(session, 'Transfer', data.settlement_bank_account_id)
    if _purpose(session, 'gateway_fees') is None:
        raise HTTPException(409, 'Your chart needs one Bank and payment charges account for Paystack fees.')
    if _purpose(session, 'gateway_clearing') is None:
        from cacu.accounting.accounts import add_account
        add_account(session, actor, uuid5(NAMESPACE_URL, f'cacu:gateway-clearing:{tenant}'), 'gateway_clearing', CLEARING_NAME)
    # Money paid beyond an invoice is kept as the customer's advance, so the advances account is added now, by an
    # Owner or Admin, rather than when a customer happens to overpay.
    from cacu.accounting.receivables import advances_account
    advances_account(session, actor, True)
    sealed = keys.seal(session.business_id, data.secret_key)
    hint = keys.hint(data.secret_key)
    existing = raw(session, 'SELECT webhook_token FROM accounting.payment_provider WHERE business_id=%s FOR UPDATE', (tenant,)).first()
    if existing:
        raw(session, """UPDATE accounting.payment_provider SET secret_ciphertext=%s,key_hint=%s,mode=%s,settlement_bank_account_id=%s,
            connected_by=%s,connected_at=now(),disconnected_at=NULL WHERE business_id=%s""",
            (sealed, hint, mode, str(data.settlement_bank_account_id), str(actor), tenant))
    else:
        raw(session, """INSERT INTO accounting.payment_provider(business_id,secret_ciphertext,key_hint,mode,webhook_token,settlement_bank_account_id,connected_by)
            VALUES(%s,%s,%s,%s,%s,%s,%s)""", (tenant, sealed, hint, mode, secrets.token_hex(32), str(data.settlement_bank_account_id), str(actor)))
    _audit(session, actor, data.request_key, 'paystack_connected', {'mode': mode, 'key_hint': hint,
                                                                       'settlement_bank_account_id': str(data.settlement_bank_account_id)})
    return settings(session, actor)


def disconnect(session, actor):
    _owner_or_admin(session, actor)
    tenant = str(session.business_id)
    if not provider(session):
        raise HTTPException(409, 'Paystack is not connected.')
    raw(session, 'UPDATE accounting.payment_provider SET secret_ciphertext=NULL,disconnected_at=now() WHERE business_id=%s', (tenant,))
    _audit(session, actor, uuid4(), 'paystack_disconnected', {})
    return settings(session, actor)


# ---- Pay links -----------------------------------------------------------------------------------------------------

def _invoice(session, invoice_id):
    row = raw(session, """SELECT i.id,i.invoice_number,i.issue_date,i.due_date,i.customer_id,d.transaction_id FROM public.invoices i
        JOIN accounting.document_map d ON d.business_id=i.business_id AND d.source_type='invoice' AND d.source_id=i.id
        WHERE i.business_id=%s AND i.id=%s""", (str(session.business_id), str(invoice_id))).first()
    if not row:
        raise HTTPException(409, 'Only an issued invoice can be paid online')
    return row


def share_link(session, actor, invoice_id):
    if not provider(session):
        raise HTTPException(409, 'Connect Paystack in Settings, Online payments, before sharing pay links.')
    invoice = _invoice(session, invoice_id)
    outstanding, waiting = invoice_outstanding(session, invoice_id)
    if outstanding <= 0:
        raise HTTPException(409, 'Nothing is owed on this invoice')
    tenant = str(session.business_id)
    token = raw(session, 'SELECT token FROM accounting.payment_link WHERE business_id=%s AND invoice_id=%s AND revoked_at IS NULL',
                (tenant, str(invoice_id))).scalar()
    if not token:
        token = secrets.token_hex(32)
        raw(session, 'INSERT INTO accounting.payment_link(token,business_id,invoice_id,created_by) VALUES(%s,%s,%s,%s)',
            (token, tenant, str(invoice_id), str(actor)))
    return {'token': token, 'invoice_number': invoice.invoice_number, 'outstanding': _money(outstanding)}


def revoke_link(session, actor, invoice_id):
    updated = raw(session, """UPDATE accounting.payment_link SET revoked_at=now(),revoked_by=%s
        WHERE business_id=%s AND invoice_id=%s AND revoked_at IS NULL RETURNING token""",
                  (str(actor), str(session.business_id), str(invoice_id))).first()
    if not updated:
        raise HTTPException(404, 'This invoice has no pay link')
    return {'revoked': True}


def _open(session, invoice_id):
    outstanding, waiting = invoice_outstanding(session, invoice_id)
    return outstanding, max(outstanding - waiting, ZERO)


def link_summary(session, invoice_id, business):
    """What a customer holding the link may see: the business, the invoice and what is still owed. Never the
    customer's contact details."""
    invoice = _invoice(session, invoice_id)
    customer = raw(session, "SELECT name,to_jsonb(c)->>'email' AS email FROM public.customers c WHERE business_id=%s AND id=%s",
                   (str(session.business_id), str(invoice.customer_id))).first()
    total = session.get(Transaction, invoice.transaction_id).amount
    outstanding, payable = _open(session, invoice_id)
    return {'business': {'name': business.get('name'), 'address': business.get('address'), 'phone': business.get('phone')},
            'invoice_number': invoice.invoice_number, 'issue_date': invoice.issue_date.isoformat() if invoice.issue_date else None,
            'due_date': invoice.due_date.isoformat() if invoice.due_date else None, 'customer_name': customer.name if customer else None,
            'total': _money(total), 'outstanding': _money(outstanding), 'payable': _money(payable),
            'needs_email': not (customer and customer.email and EMAIL.fullmatch(customer.email)), 'minimum': _money(MINIMUM)}


def start_payment(session, actor, token, invoice_id, data: PayStart):
    """Records the checkout before Paystack hears of it, so every reference Paystack knows is one CACU knows."""
    tenant = str(session.business_id)
    invoice = _invoice(session, invoice_id)
    outstanding, payable = _open(session, invoice_id)
    amount = Decimal(data.amount)
    if payable <= 0:
        raise HTTPException(409, 'Nothing is left to pay on this invoice.')
    if amount < MINIMUM and amount != payable:
        raise HTTPException(422, f'Pay at least ₦{MINIMUM:,.2f}.')
    if amount > payable:
        raise HTTPException(422, f'At most ₦{payable:,.2f} is still owed.')
    started = raw(session, """SELECT count(*) FROM accounting.online_payment WHERE business_id=%s AND link_token=%s
        AND status='pending' AND created_at > now() - interval '1 hour'""", (tenant, token)).scalar()
    if started >= PENDING_PER_HOUR:
        raise HTTPException(429, 'Too many payments were started from this link. Try again in an hour.')
    email = raw(session, "SELECT to_jsonb(c)->>'email' FROM public.customers c WHERE business_id=%s AND id=%s",
                (tenant, str(invoice.customer_id))).scalar()
    if not (email and EMAIL.fullmatch(email)):
        email = (data.email or '').strip()
        if not EMAIL.fullmatch(email):
            raise HTTPException(422, 'Enter an email address for your Paystack receipt.')
    payment_id = uuid4()
    reference = 'CACU-PAY-' + payment_id.hex
    raw(session, """INSERT INTO accounting.online_payment(business_id,id,reference,link_token,invoice_id,customer_id,amount,created_by)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s)""", (tenant, str(payment_id), reference, token, str(invoice_id), str(invoice.customer_id), amount, str(actor)))
    return {'reference': reference, 'amount_kobo': int(amount * 100), 'email': email, 'invoice_number': invoice.invoice_number}


# ---- Verified payments (PR-14) -------------------------------------------------------------------------------------

def _kobo(value):
    try:
        return Decimal(int(value)) / 100
    except (TypeError, ValueError, InvalidOperation):
        return None


def _paid_at(session, verified):
    text = verified.get('paid_at') or verified.get('paidAt')
    try:
        moment = datetime.fromisoformat(str(text).replace('Z', '+00:00'))
    except ValueError:
        return None
    return moment if moment.tzinfo else None


def pending_references(session, older_than_minutes=2, limit=50):
    rows = raw(session, """SELECT reference FROM accounting.online_payment WHERE business_id=%s AND status IN ('pending','failed')
        AND created_at < now() - make_interval(mins => %s) AND created_at > now() - interval '7 days' ORDER BY created_at LIMIT %s""",
               (str(session.business_id), older_than_minutes, limit)).all()
    return [r.reference for r in rows]


def _review(session, payment, reason, verified=None):
    paid = _kobo((verified or {}).get('amount'))
    raw(session, """UPDATE accounting.online_payment SET status='needs_review',review_reason=%s,paid_amount=%s,decided_at=now()
        WHERE business_id=%s AND id=%s""", (reason, paid if paid and paid > 0 else None, str(session.business_id), str(payment.id)))
    return {'outcome': 'needs_review', 'reason': reason}


def apply_verified(session, actor, reference, verified: dict):
    """Posts a payment Paystack's verify endpoint confirmed, once. Anything else leaves the books alone."""
    if not REFERENCE.fullmatch(reference):
        raise HTTPException(422, 'Unknown payment reference')
    tenant = str(session.business_id)
    payment = raw(session, 'SELECT * FROM accounting.online_payment WHERE business_id=%s AND reference=%s FOR UPDATE', (tenant, reference)).first()
    if not payment:
        raise HTTPException(404, 'Unknown payment reference')
    if payment.status in {'posted', 'needs_review'}:
        return {'outcome': 'already_' + payment.status, 'status': payment.status}
    state = verified.get('status')
    if state != 'success':
        age = (datetime.now(payment.created_at.tzinfo) - payment.created_at).total_seconds()
        # Paystack keeps a checkout open for a while; only an old one that never succeeded is marked failed.
        if payment.status == 'pending' and state in {'failed', 'abandoned', 'reversed', 'not_found'} and age > 6 * 3600:
            raw(session, "UPDATE accounting.online_payment SET status='failed',decided_at=now() WHERE business_id=%s AND id=%s", (tenant, str(payment.id)))
            return {'outcome': 'failed', 'status': 'failed'}
        return {'outcome': 'not_paid', 'status': payment.status}
    if verified.get('reference') != reference:
        return _review(session, payment, 'Paystack answered for a different reference.', verified)
    if verified.get('currency') != 'NGN':
        return _review(session, payment, 'Paid in a currency other than naira.', verified)
    paid = _kobo(verified.get('amount'))
    paid_at = _paid_at(session, verified)
    if paid is None or paid <= 0 or paid_at is None:
        return _review(session, payment, 'Paystack returned an unreadable amount or date.', verified)
    fee = _kobo(verified.get('fees'))
    fee = fee if fee is not None and fee >= 0 else None
    day = paid_at.astimezone(ZoneInfo(session.business_timezone)).date()
    cutover = raw(session, 'SELECT cutover_date FROM accounting.business_map WHERE business_id=%s', (tenant,)).scalar()
    day = max(day, cutover)
    clearing = _purpose(session, 'gateway_clearing')
    if clearing is None:
        return _review(session, payment, 'Card and online payments clearing is missing from the chart.', verified)
    outstanding, _waiting = invoice_outstanding(session, payment.invoice_id)
    # The money has arrived: the invoice takes what it still needs, and the rest is the customer's advance.
    part = min(paid, max(outstanding, ZERO))
    advance = paid - part
    receivable = raw(session, """SELECT m.account_id FROM accounting.document_map d JOIN accounting."transaction" t ON t.id=d.transaction_id AND t.business_id=d.business_id
        JOIN accounting.account_map m ON m.business_id=t.business_id AND m.library_id=t.account_id
        WHERE d.business_id=%s AND d.source_type='invoice' AND d.source_id=%s""", (tenant, str(payment.invoice_id))).scalar()
    posting = {'invoice': None, 'advance': None}
    if part > 0:
        key = uuid5(payment.id, 'receipt')
        result = post_command(session, actor, PostingCommand(request_key=key, kind='gateway_receipt', source_id=key, target_id=payment.invoice_id,
            main_account_id=receivable, counterparty_id=payment.customer_id, entry_date=day, credited=True, narration=f'Paystack payment {reference}',
            lines=[{'account_id': clearing, 'amount': _money(part)}]), internal=True)
        posting['invoice'] = {'amount': _money(part), 'transaction_no': result.get('transaction_no')}
        raw(session, """INSERT INTO public.payments(id,business_id,reference,purpose,invoice_id,amount,currency,status,channel,customer_email,initialized_by,customer_id)
            VALUES(%s,%s,%s,'invoice',%s,%s,'NGN','success','paystack','',%s,%s)""",
            (str(key), tenant, reference, str(payment.invoice_id), part, str(actor), str(payment.customer_id)))
        target = session.get(Transaction, raw(session, "SELECT transaction_id FROM accounting.document_map WHERE business_id=%s AND source_type='invoice' AND source_id=%s",
                                              (tenant, str(payment.invoice_id))).scalar())
        remaining = target.amount - target.cleared(session)
        raw(session, 'UPDATE public.invoices SET status=%s,updated_at=now() WHERE business_id=%s AND id=%s',
            ('paid' if remaining == 0 else 'sent', tenant, str(payment.invoice_id)))
    if advance > 0:
        from cacu.accounting.receivables import advances_account
        key = uuid5(payment.id, 'advance')
        result = post_command(session, actor, PostingCommand(request_key=key, kind='customer_advance', source_id=key, main_account_id=clearing,
            entry_date=day, credited=False, narration=f'Paid online beyond the invoice ({reference})',
            lines=[{'account_id': advances_account(session, actor, False), 'amount': _money(advance), 'credited': True}]), internal=True)
        raw(session, """INSERT INTO accounting.customer_advance(business_id,id,customer_id,kind,amount,entry_date,receipt_id,note,posting,created_by)
            VALUES(%s,%s,%s,'received',%s,%s,%s,%s,%s::jsonb,%s)""",
            (tenant, str(key), str(payment.customer_id), advance, day, str(payment.id), 'Paid online beyond the invoice', json.dumps(result), str(actor)))
        posting['advance'] = {'amount': _money(advance), 'transaction_no': result.get('transaction_no')}
    channel = str(verified.get('channel') or '')[:40] or None
    raw(session, """UPDATE accounting.online_payment SET status='posted',paid_amount=%s,fee=%s,paid_at=%s,channel=%s,posting=%s::jsonb,decided_at=now()
        WHERE business_id=%s AND id=%s""", (paid, fee, paid_at, channel, json.dumps(posting), tenant, str(payment.id)))
    return {'outcome': 'posted', 'status': 'posted', 'paid': _money(paid), 'applied': _money(part), 'advance': _money(advance),
            'outstanding': _money(max(outstanding - part, ZERO))}


def payment_status(session, token, reference):
    row = raw(session, 'SELECT status,paid_amount FROM accounting.online_payment WHERE business_id=%s AND reference=%s AND link_token=%s',
              (str(session.business_id), reference, token)).first()
    if not row:
        raise HTTPException(404, 'Unknown payment reference')
    return {'status': row.status, 'paid': _money(row.paid_amount) if row.paid_amount is not None else None}


def record_event(session, key, kind, reference, event):
    """Stores a webhook event once. False means it was seen before (Doc 14 TEST-203)."""
    return raw(session, """INSERT INTO accounting.payment_event(event_key,business_id,kind,reference,payload) VALUES(%s,%s,%s,%s,%s::jsonb)
        ON CONFLICT (event_key) DO NOTHING RETURNING event_key""", (key, str(session.business_id), kind[:80], (reference or '')[:200] or None,
                                                                  json.dumps(event))).first() is not None


# ---- Settlements (PR-15) -------------------------------------------------------------------------------------------

def known_settlements(session):
    return {r.provider_id for r in raw(session, 'SELECT provider_id FROM accounting.gateway_settlement WHERE business_id=%s', (str(session.business_id),)).all()}


def _settled_on(settlement, fallback):
    text = settlement.get('settlement_date') or settlement.get('settledAt') or settlement.get('createdAt')
    try:
        return date.fromisoformat(str(text)[:10])
    except ValueError:
        return fallback


def settle(session, actor, settlement: dict, transactions: list[dict]):
    """Matches one paid-out Paystack settlement to the payments CACU took, and posts it once."""
    tenant = str(session.business_id)
    provider_id = str(settlement.get('id') or '')
    if not provider_id or len(provider_id) > 40:
        return {'outcome': 'unreadable'}
    if provider_id in known_settlements(session):
        return {'outcome': 'already_recorded'}
    if str(settlement.get('status') or '').lower() not in {'success', 'successful', 'processed', 'paid'}:
        return {'outcome': 'not_paid_out'}
    connection = provider(session)
    if not connection:
        raise HTTPException(409, 'Paystack is not connected.')
    gross = fee = unmatched = ZERO
    matched = []
    for item in transactions:
        reference = item.get('reference')
        amount = _kobo(item.get('amount')) or ZERO
        charged = _kobo(item.get('fees'))
        row = raw(session, """SELECT id,paid_amount,fee FROM accounting.online_payment WHERE business_id=%s AND reference=%s
            AND status='posted' AND settlement_id IS NULL FOR UPDATE""", (tenant, reference)).first() if isinstance(reference, str) and REFERENCE.fullmatch(reference) else None
        if row is None or amount != row.paid_amount:
            unmatched += amount - (charged or ZERO)
            continue
        cost = charged if charged is not None else (row.fee or ZERO)
        gross += row.paid_amount
        fee += cost
        matched.append(row.id)
    net = gross - fee
    reported = _kobo(settlement.get('total_amount'))
    notes = []
    if unmatched:
        notes.append(f'₦{unmatched:,.2f} in this payout is not from a CACU pay link; record it yourself if it belongs in the books.')
    if reported is not None and reported != net + unmatched:
        notes.append(f'Paystack reports ₦{reported:,.2f} paid out; CACU matched ₦{net + unmatched:,.2f}.')
    if net < 0:
        notes.append('Fees are larger than the payments matched; nothing was posted.')
        gross = fee = net = ZERO
        matched = []
    day = max(_settled_on(settlement, business_today(session)),
              raw(session, 'SELECT cutover_date FROM accounting.business_map WHERE business_id=%s', (tenant,)).scalar())
    posting = None
    if gross > 0:
        key = uuid5(NAMESPACE_URL, f'cacu:paystack-settlement:{tenant}:{provider_id}')
        lines = []
        if net > 0:
            lines.append({'account_id': connection.settlement_bank_account_id, 'amount': _money(net)})
        if fee > 0:
            lines.append({'account_id': _purpose(session, 'gateway_fees'), 'amount': _money(fee)})
        posting = post_command(session, actor, PostingCommand(request_key=key, kind='gateway_settlement', source_id=key,
            main_account_id=_purpose(session, 'gateway_clearing'), entry_date=day, credited=True, narration=f'Paystack payout {provider_id}',
            lines=lines), internal=True)
    raw(session, """INSERT INTO accounting.gateway_settlement(business_id,provider_id,settled_on,gross,fee,net,reported_net,unmatched,bank_account_id,status,note,posting,created_by)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s)""",
        (tenant, provider_id, day, gross, fee, net, reported, unmatched, str(connection.settlement_bank_account_id),
         'needs_review' if notes else 'posted', ' '.join(notes)[:500] or None, json.dumps(posting) if posting else None, str(actor)))
    for payment_id in matched:
        raw(session, 'UPDATE accounting.online_payment SET settlement_id=%s WHERE business_id=%s AND id=%s', (provider_id, tenant, str(payment_id)))
    return {'outcome': 'needs_review' if notes else 'posted', 'gross': _money(gross), 'fee': _money(fee), 'net': _money(net), 'matched': len(matched)}


# ---- Overview ------------------------------------------------------------------------------------------------------

def overview(session, actor):
    tenant = str(session.business_id)
    payments = raw(session, """SELECT p.reference,p.status,p.amount,p.paid_amount,p.fee,p.paid_at,p.channel,p.review_reason,p.settlement_id,p.created_at,
        i.invoice_number,c.name AS customer FROM accounting.online_payment p
        JOIN public.invoices i ON i.business_id=p.business_id AND i.id=p.invoice_id
        LEFT JOIN public.customers c ON c.business_id=p.business_id AND c.id=p.customer_id
        WHERE p.business_id=%s AND (p.status<>'pending' OR p.created_at > now() - interval '1 day') ORDER BY p.created_at DESC LIMIT 100""", (tenant,)).all()
    payouts = raw(session, """SELECT provider_id,settled_on,gross,fee,net,reported_net,unmatched,status,note FROM accounting.gateway_settlement
        WHERE business_id=%s ORDER BY settled_on DESC,provider_id DESC LIMIT 50""", (tenant,)).all()
    awaiting = raw(session, """SELECT coalesce(sum(paid_amount),0) FROM accounting.online_payment WHERE business_id=%s AND status='posted' AND settlement_id IS NULL""",
                   (tenant,)).scalar()
    return {'settings': settings(session, actor),
            'awaiting_payout': _money(awaiting),
            'payments': [{'reference': p.reference, 'status': p.status, 'amount': _money(p.amount),
                          'paid': _money(p.paid_amount) if p.paid_amount is not None else None,
                          'fee': _money(p.fee) if p.fee is not None else None, 'paid_at': p.paid_at.isoformat() if p.paid_at else None,
                          'channel': p.channel, 'review_reason': p.review_reason, 'settled': p.settlement_id is not None,
                          'invoice_number': p.invoice_number, 'customer': p.customer, 'started_at': p.created_at.isoformat()} for p in payments],
            'payouts': [{'id': s.provider_id, 'settled_on': s.settled_on.isoformat(), 'gross': _money(s.gross), 'fee': _money(s.fee),
                         'net': _money(s.net), 'reported_net': _money(s.reported_net) if s.reported_net is not None else None,
                         'unmatched': _money(s.unmatched), 'status': s.status, 'note': s.note} for s in payouts]}
