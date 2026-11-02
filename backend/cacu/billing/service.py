"""Checkout, payment verification and webhook handling for CACU subscriptions (Doc 14 SUB-02, SUB-03)."""
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
ERRORS = {
    'ACCESS_DENIED': (403, 'Business membership required'),
    'BILLING_OWNER_OR_ADMIN_REQUIRED': (403, 'Only an Owner or Admin can manage the subscription'),
    'PLAN_LIMIT module.modes': (403, 'Hybrid mode is on the Chairman Plan only. Switch to Products or Services first.'),
    'BILLING_PLAN_CHANGE_NOT_AVAILABLE': (409, 'Changing an active plan is not available yet'),
    'BILLING_REQUEST_KEY_REUSED': (409, 'This checkout request was already used for another plan'),
    'BILLING_NO_SUBSCRIPTION': (409, 'This business has no subscription'),
    'BILLING_PLAN_INVALID': (422, 'Choose a valid plan and billing interval'),
}


class Checkout(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: UUID
    plan: Literal['BASE', 'GROW', 'TOP']
    interval: Literal['monthly', 'annual'] = 'monthly'


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


def apply_verified(reference: str, event_key: str | None = None) -> dict:
    """Ask Paystack for the payment, then let the database match amount, currency and reference to the invoice."""
    if not REFERENCE.fullmatch(reference):
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
    return result


def verify_return(business_id: UUID, actor: UUID, data: Verification) -> dict:
    """The owner came back from checkout. The redirect proves nothing; only the verified payment does (TEST-201)."""
    with platform_transaction() as cursor:
        invoice = call(cursor, 'SELECT platform.invoice_for(%s,%s,%s)', (business_id, actor, data.reference))
    if not invoice:
        raise HTTPException(404, 'Unknown payment reference')
    if invoice['status'] != 'open':
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
    if not (isinstance(reference, str) and REFERENCE.fullmatch(reference)):
        return {'received': True}
    with platform_transaction() as cursor:
        cursor.execute('SELECT platform.record_billing_event(%s,%s,%s,%s)', (key, kind, reference, json.dumps(event)))
        new = cursor.fetchone()[0]
    if not new:
        return {'received': True, 'outcome': 'duplicate'}
    if kind != 'charge.success':
        return {'received': True}
    return {'received': True, **apply_verified(reference, key)}
