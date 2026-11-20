"""Checkout, payment verification, webhooks and saved-card renewals for CACU subscriptions (Doc 14 SUB-02 to SUB-08)."""
import json
import logging
import os
import re
from contextlib import contextmanager
from datetime import datetime
from typing import Literal
from uuid import UUID
import psycopg
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict
from cacu.database_tls import database_connect_options
from . import paystack

log = logging.getLogger(__name__)
REFERENCE = re.compile(r'^CACU-SUB-[0-9a-f]{32}$')
# A saved-card charge has its own reference per attempt; it is never something an owner returns with.
PAYMENT_REFERENCE = re.compile(r'^CACU-(SUB|REN)-[0-9a-f]{32}$')
ERRORS = {
    'ACCESS_DENIED': (403, 'Business membership required'),
    'BILLING_OWNER_OR_ADMIN_REQUIRED': (403, 'Only an Owner or Admin can manage the subscription'),
    'PERMISSION_DENIED billing.edit': (403, 'Only the business owner can choose or change the plan'),
    'PERMISSION_DENIED billing.post': (403, 'You do not have permission to pay for this business. Ask the business owner.'),
    'PLAN_LIMIT module.modes': (403, 'Hybrid mode is on the Chairman Plan only. Switch to Products or Services first.'),
    'BILLING_ALREADY_ON_PLAN': (409, 'This business is already on that plan'),
    'BILLING_DOWNGRADE_IS_SCHEDULED': (409, 'A move to a smaller plan is scheduled for the end of the period, not paid now'),
    'BILLING_UPGRADE_NEEDS_CHECKOUT': (409, 'A move to a bigger plan is paid through checkout'),
    'BILLING_INTERVAL_CHANGES_AT_RENEWAL': (409, 'Switching from yearly to monthly is scheduled for the end of the year, not paid now'),
    'BILLING_RENEW_FIRST': (409, 'This period ends within a day. Renew first, then upgrade'),
    'BILLING_SCHEDULE_NEEDS_ACTIVE_PLAN': (409, 'Choose and pay for a plan instead; there is no paid period to change'),
    'BILLING_REQUEST_KEY_REUSED': (409, 'This checkout request was already used for another plan'),
    'BILLING_NO_SUBSCRIPTION': (409, 'This business has no subscription'),
    'BILLING_NO_RENEWAL_DUE': (409, 'There is no renewal to pay right now'),
    'BILLING_PLAN_INVALID': (422, 'Choose a valid plan and billing interval'),
}


class Checkout(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: UUID
    plan: Literal['BASE', 'GROW', 'TOP']
    interval: Literal['monthly', 'annual'] = 'monthly'


class PlanChange(BaseModel):
    model_config = ConfigDict(extra='forbid')
    plan: Literal['BASE', 'GROW', 'TOP']
    interval: Literal['monthly', 'annual'] | None = None


class Verification(BaseModel):
    model_config = ConfigDict(extra='forbid')
    reference: str


def connect():
    dsn = os.environ.get('CACU_DATABASE_URL')
    if not dsn:
        raise HTTPException(503, 'Billing unavailable')
    return psycopg.connect(dsn, **database_connect_options())


@contextmanager
def platform_transaction():
    """Runtime-role transaction with no tenant claims; platform functions decide what the caller may do."""
    with connect() as connection:
        with connection.transaction():
            with connection.cursor() as cursor:
                cursor.execute('SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user')
                if cursor.fetchone() != ('cacu_runtime', False, False):
                    raise HTTPException(503, 'Restricted runtime role required')
                cursor.execute("SELECT set_config('statement_timeout', '10000', true)")
                yield cursor


def call(cursor, sql, args):
    try:
        cursor.execute(sql, args)
    except psycopg.Error as exc:
        known = ERRORS.get(str(exc.diag.message_primary))
        if known:
            raise HTTPException(*known) from exc
        if isinstance(exc, psycopg.errors.InsufficientPrivilege):
            raise HTTPException(403, 'Billing permission required') from exc
        raise
    return cursor.fetchone()[0]


def checkout(business_id: UUID, actor: UUID, data: Checkout) -> dict:
    with platform_transaction() as cursor:
        invoice = call(cursor, 'SELECT platform.open_checkout(%s,%s,%s,%s,%s)',
                       (business_id, actor, data.request_key, data.plan, data.interval))
    return _checkout_link(business_id, invoice)


def renewal_checkout(business_id: UUID, actor: UUID) -> dict:
    """SUB-04: the owner pays the open renewal invoice through Paystack checkout, with or without a saved card."""
    with platform_transaction() as cursor:
        invoice = call(cursor, 'SELECT platform.renewal_checkout(%s,%s)', (business_id, actor))
    return _checkout_link(business_id, invoice)


def _checkout_link(business_id: UUID, invoice: dict) -> dict:
    if invoice['status'] != 'open':
        raise HTTPException(409, 'This checkout is already settled')
    if not invoice['authorization_url']:
        if not invoice['email']:
            raise HTTPException(409, 'Add an email address to your account before paying')
        url = paystack.initialize(invoice['email'], invoice['total_kobo'], invoice['reference'],
                                  {'business_id': str(business_id), 'invoice': invoice['invoice']})
        with platform_transaction() as cursor:
            cursor.execute('SELECT platform.attach_checkout(%s,%s)', (invoice['reference'], url))
        invoice['authorization_url'] = url
    invoice.pop('email')
    return invoice


def schedule(business_id: UUID, actor: UUID, data: PlanChange) -> dict:
    """SUB-06, SUB-07: schedule a smaller plan or yearly-to-monthly for the period end; the current plan and interval cancel it."""
    with platform_transaction() as cursor:
        return call(cursor, 'SELECT platform.schedule_plan_change(%s,%s,%s,%s)', (business_id, actor, data.plan, data.interval))


def apply_verified(reference: str, event_key: str | None = None) -> dict:
    """Ask Paystack for the payment, then let the database match amount, currency and reference to the invoice."""
    if not PAYMENT_REFERENCE.fullmatch(reference):
        raise HTTPException(422, 'Unknown payment reference')
    payment = paystack.verify(reference)
    if payment.get('status') != 'success' or payment.get('reference') != reference:
        return {'outcome': 'not_paid'}
    try:
        amount = int(payment['amount'])
        paid_at = datetime.fromisoformat(str(payment.get('paid_at') or payment.get('paidAt')).replace('Z', '+00:00'))
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(502, 'Payment provider returned an unreadable payment') from exc
    with platform_transaction() as cursor:
        result = call(cursor, 'SELECT platform.apply_verified_payment(%s,%s,%s,%s,%s,%s)',
                      (reference, amount, payment.get('currency'), paid_at, payment.get('channel'), event_key))
    if result['outcome'] == 'amount_or_currency_mismatch':
        log.warning('CACU invoice %s flagged for review: verified payment does not match', result['invoice'])
    elif result['outcome'] in {'upgrade_no_longer_applies', 'renewal_no_longer_applies', 'invoice_void'}:
        log.warning('CACU invoice %s flagged for review: paid after it stopped applying', result['invoice'])
    if result['outcome'] == 'activated' and isinstance(payment.get('authorization'), dict):
        # A reusable card from a confirmed payment is kept for renewals; the database checks it is reusable.
        customer = payment.get('customer') if isinstance(payment.get('customer'), dict) else {}
        with platform_transaction() as cursor:
            cursor.execute('SELECT platform.save_payment_method(%s,%s,%s)',
                           (reference, json.dumps({**payment['authorization'], 'channel': payment.get('channel')}), customer.get('email')))
    return result


def renew_due() -> dict:
    """SUB-04, SUB-08: charge each saved card whose renewal attempt is due. Counts only; no card or provider details."""
    with platform_transaction() as cursor:
        due = call(cursor, 'SELECT platform.due_card_charges()', ())
    report = {'due': len(due), 'activated': 0, 'declined': 0, 'pending': 0}
    for invoice_reference in due:
        with platform_transaction() as cursor:
            attempt = call(cursor, 'SELECT platform.start_charge_attempt(%s)', (invoice_reference,))
        if not attempt:
            continue
        try:
            charge = paystack.charge_authorization(attempt['authorization_code'], attempt['email'], attempt['amount_kobo'],
                                                   attempt['reference'], {'business_id': attempt['business_id'], 'invoice': attempt['invoice']})
        except HTTPException:
            charge = {'status': 'failed', 'gateway_response': 'Payment provider unavailable'}
        if charge.get('status') == 'success':
            outcome = apply_verified(attempt['reference'])['outcome']
            if outcome == 'activated':
                report['activated'] += 1
                continue
        else:
            outcome = 'declined' if charge.get('status') == 'failed' else 'pending'
        report['declined' if outcome != 'pending' else 'pending'] += 1
        # A pending charge can still succeed; its charge.success webhook activates it through the same verify step.
        with platform_transaction() as cursor:
            cursor.execute('SELECT platform.finish_charge_attempt(%s,%s,%s)',
                           (attempt['reference'], outcome, str(charge.get('gateway_response') or '')))
    return report


def verify_return(business_id: UUID, actor: UUID, data: Verification) -> dict:
    """The owner came back from checkout. The redirect proves nothing; only the verified payment does (TEST-201)."""
    with platform_transaction() as cursor:
        invoice = call(cursor, 'SELECT platform.invoice_for(%s,%s,%s)', (business_id, actor, data.reference))
    if not invoice:
        raise HTTPException(404, 'Unknown payment reference')
    # A voided invoice may still have been paid at Paystack before it was voided; verify flags that for review.
    if invoice['status'] not in {'open', 'void'}:
        return {'outcome': 'already_applied' if invoice['status'] == 'paid' else 'invoice_' + invoice['status']}
    return apply_verified(data.reference)


def webhook(raw: bytes, signature: str | None) -> dict:
    if not paystack.signature_valid(raw, signature):
        log.warning('Paystack webhook rejected: bad signature')
        raise HTTPException(401, 'Invalid signature')
    try:
        event = json.loads(raw)
        kind, data = event['event'], event['data']
        reference = data.get('reference')
        key = f"{kind}:{data['id']}"
    except (ValueError, KeyError, TypeError, AttributeError) as exc:
        raise HTTPException(400, 'Unreadable event') from exc
    # Tenant payment references are routed elsewhere (Doc 11); only CACU subscription events are handled here.
    if not (isinstance(reference, str) and PAYMENT_REFERENCE.fullmatch(reference)):
        return {'received': True}
    with platform_transaction() as cursor:
        cursor.execute('SELECT platform.record_billing_event(%s,%s,%s,%s)', (key, kind, reference, json.dumps(event)))
        new = cursor.fetchone()[0]
    if not new:
        return {'received': True, 'outcome': 'duplicate'}
    if kind != 'charge.success':
        return {'received': True}
    return {'received': True, **apply_verified(reference, key)}
