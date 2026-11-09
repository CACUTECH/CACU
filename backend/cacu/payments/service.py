"""The parts of online payments no signed-in person starts: a customer paying from a link, a Paystack webhook, and the
check job. Each finds its business through a secret token (or the job's list of connected businesses), then works
inside that business's own transaction, acting as the person who shared the link or connected Paystack (falling back
to the owner). Paystack is called outside database transactions."""
import json
import logging
import os
from datetime import timedelta
from uuid import UUID
from fastapi import HTTPException
from cacu.accounting import online_payments as op
from cacu.accounting.session import library_transaction
from cacu.billing.service import platform_transaction
from . import keys
from .paystack import Paystack

log = logging.getLogger(__name__)
LINK_UNAVAILABLE = 'This pay link does not work. It may have been typed wrongly, or the business has withdrawn it.'


def _lookup(sql: str, token: str) -> dict | None:
    with platform_transaction() as cursor:
        cursor.execute(sql, (token,))
        row = cursor.fetchone()
    return row[0] if row and row[0] else None


def link_target(token: str) -> dict:
    if not op.TOKEN.fullmatch(token or ''):
        raise HTTPException(404, LINK_UNAVAILABLE)
    target = _lookup('SELECT accounting.payment_link_target(%s)', token)
    if not target or not target.get('actor'):
        raise HTTPException(404, LINK_UNAVAILABLE)
    return {'business_id': UUID(target['business_id']), 'invoice_id': UUID(target['invoice_id']), 'actor': UUID(target['actor']),
            'business': target.get('business') or {}}


def _client(session) -> Paystack:
    return Paystack(op.secret(session))


def callback_url(token: str) -> str | None:
    base = os.environ.get('CACU_APP_URL', '').rstrip('/')
    return f'{base}/pay/{token}' if base.startswith('https://') else None


def public_summary(token: str) -> dict:
    target = link_target(token)
    with library_transaction(target['actor'], target['business_id']) as session:
        return op.link_summary(session, target['invoice_id'], target['business'])


# Public calls do not take the per-minute write allowance of the person who shared the link (API-012), or anyone holding
# a link could use up the business's own allowance; each link instead allows a few checkouts an hour.
def public_start(token: str, data: op.PayStart) -> dict:
    target = link_target(token)
    with library_transaction(target['actor'], target['business_id']) as session:
        started = op.start_payment(session, target['actor'], token, target['invoice_id'], data)
        client = _client(session)
    url = client.initialize(reference=started['reference'], amount_kobo=started['amount_kobo'], email=started['email'],
                            callback_url=callback_url(token), metadata={'invoice_number': started['invoice_number'], 'source': 'cacu_pay_link'})
    return {'authorization_url': url, 'reference': started['reference']}


def _verify_and_apply(business_id: UUID, actor: UUID, reference: str, client: Paystack, public: bool = False) -> dict:
    verified = client.verify(reference)
    with library_transaction(actor, business_id, write=not public, while_read_only=True) as session:
        return op.apply_verified(session, actor, reference, verified)


def public_verify(token: str, data: op.PayReturn) -> dict:
    """The customer came back from Paystack. The redirect proves nothing; only the verified payment does (TEST-201)."""
    target = link_target(token)
    with library_transaction(target['actor'], target['business_id']) as session:
        status = op.payment_status(session, token, data.reference)
        client = _client(session)
    if status['status'] in {'pending', 'failed'}:
        _verify_and_apply(target['business_id'], target['actor'], data.reference, client, public=True)
        with library_transaction(target['actor'], target['business_id']) as session:
            status = op.payment_status(session, token, data.reference)
            status['summary'] = op.link_summary(session, target['invoice_id'], target['business'])
    return status


def webhook(webhook_token: str, raw: bytes, signature: str | None) -> dict:
    if not op.TOKEN.fullmatch(webhook_token or ''):
        raise HTTPException(404, 'Unknown webhook address')
    target = _lookup('SELECT accounting.payment_webhook_target(%s)', webhook_token)
    if not target or not target.get('actor'):
        raise HTTPException(404, 'Unknown webhook address')
    business_id, actor = UUID(target['business_id']), UUID(target['actor'])
    client = Paystack(keys.unseal(business_id, target['secret']))
    if not client.signature_valid(raw, signature):
        log.warning('Paystack webhook rejected for a business: bad signature')
        raise HTTPException(401, 'Invalid signature')
    try:
        event = json.loads(raw)
        kind, data = str(event['event']), event['data']
        reference = data.get('reference')
        key = f"{kind}:{data['id']}"
    except (ValueError, KeyError, TypeError, AttributeError) as exc:
        raise HTTPException(400, 'Unreadable event') from exc
    with library_transaction(actor, business_id, write=True, while_read_only=True) as session:
        new = op.record_event(session, key[:200], kind, reference if isinstance(reference, str) else None, event)
    if not new:
        return {'received': True, 'outcome': 'duplicate'}
    # Only payments started from a CACU pay link are CACU's to post; the business's other Paystack sales are stored
    # and left alone. The event body is never trusted: the verify call decides.
    if kind != 'charge.success' or not (isinstance(reference, str) and op.REFERENCE.fullmatch(reference)):
        return {'received': True}
    try:
        return {'received': True, **_verify_and_apply(business_id, actor, reference, client)}
    except HTTPException as exc:
        if exc.status_code == 404:
            log.warning('Paystack webhook for an unknown CACU reference held for review')
            return {'received': True, 'outcome': 'unknown_reference'}
        raise


def check_business(business_id: UUID, actor: UUID, days: int = 14, min_age_minutes: int = 2) -> dict:
    """Verifies checkouts still waiting, then matches Paystack payouts of the last days (PR-15)."""
    with library_transaction(actor, business_id) as session:
        client = _client(session)
        references = op.pending_references(session, min_age_minutes)
        known = op.known_settlements(session)
        today = op.business_today(session)
    report = {'checked': 0, 'posted': 0, 'payouts': 0, 'payouts_for_review': 0}
    for reference in references:
        report['checked'] += 1
        if _verify_and_apply(business_id, actor, reference, client).get('outcome') == 'posted':
            report['posted'] += 1
    for settlement in client.settlements(today - timedelta(days=days), today):
        provider_id = str(settlement.get('id') or '')
        if not provider_id or provider_id in known:
            continue
        transactions = client.settlement_transactions(provider_id)
        with library_transaction(actor, business_id, write=True, while_read_only=True) as session:
            outcome = op.settle(session, actor, settlement, transactions)['outcome']
        if outcome == 'posted':
            report['payouts'] += 1
        elif outcome == 'needs_review':
            report['payouts_for_review'] += 1
    return report


def check_all() -> dict:
    """The scheduled job: every connected business, one at a time; a failure in one does not stop the others."""
    with platform_transaction() as cursor:
        cursor.execute('SELECT accounting.payment_businesses()')
        businesses = cursor.fetchone()[0] or []
    totals = {'businesses': 0, 'failed': 0, 'checked': 0, 'posted': 0, 'payouts': 0, 'payouts_for_review': 0}
    for item in businesses:
        if not item.get('actor'):
            totals['failed'] += 1
            continue
        totals['businesses'] += 1
        try:
            report = check_business(UUID(item['business_id']), UUID(item['actor']))
        except HTTPException as exc:
            log.warning('Online payment check failed for a business: %s', exc.status_code)
            totals['failed'] += 1
            continue
        for name, value in report.items():
            totals[name] += value
    return totals
