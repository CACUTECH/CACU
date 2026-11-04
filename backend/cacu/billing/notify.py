"""Billing reminders by email (Resend) and SMS or WhatsApp (Termii). Keys come from the environment and are never
logged; reports carry counts only, never addresses, numbers or message bodies."""
import os
import re
from datetime import datetime
from zoneinfo import ZoneInfo
import httpx
from .service import call, platform_transaction

LAGOS = ZoneInfo('Africa/Lagos')


class SendFailed(Exception):
    """The provider refused or could not be reached; the reason is safe to store."""


def _date(value) -> str:
    moment = datetime.fromisoformat(str(value).replace('Z', '+00:00')).astimezone(LAGOS)
    return f'{moment.day} {moment:%b %Y}'


def _naira(kobo, sign: str) -> str:
    amount = int(kobo) / 100
    return f"{sign}{amount:,.0f}" if int(kobo) % 100 == 0 else f"{sign}{amount:,.2f}"


def billing_url() -> str:
    base = os.environ.get('CACU_APP_URL', '').rstrip('/')
    return f'{base}/settings/billing' if base.startswith('https://') else 'the Billing page in CACU'


def render(kind: str, channel: str, details: dict, business: str) -> tuple[str, str]:
    """(subject, text). SMS uses NGN, since the naira sign forces a costlier unicode SMS."""
    money = lambda kobo: _naira(kobo, '₦' if channel == 'email' else 'NGN ')
    url = billing_url()
    if kind == 'trial_ending':
        subject = f"Your CACU trial ends on {_date(details['ends_at'])}"
        body = (f"Your free {details['plan']} Plan trial ends on {_date(details['ends_at'])}. Choose a plan to keep its features: {url}. "
                'If you do not choose, you move to the General Plan and your first payment becomes due.')
    elif kind == 'renewal_due':
        subject = f"Your CACU renewal is due on {_date(details['due_at'])}"
        body = (f"Your {details['plan']} Plan renews on {_date(details['due_at'])}. "
                + (f"We will charge {money(details['total_kobo'])} to your saved card." if details.get('card')
                   else f"Pay {money(details['total_kobo'])} by then to keep full access: {url}."))
    elif kind == 'card_declined':
        subject = 'Your CACU card payment did not go through'
        body = (f"We could not charge your card for your CACU renewal of {money(details['total_kobo'])}. "
                f"We will try again over the next few days, or you can pay now: {url}.")
    elif kind == 'payment_due':
        subject = 'Your CACU payment is due'
        body = f"Your CACU payment is due. Pay by {_date(details['pay_by'])} to keep full access: {url}."
    elif kind == 'books_exception':
        checks = {'trial_balance': 'the trial balance', 'receivables': 'customer balances', 'payables': 'supplier balances',
                  'stock': 'stock value', 'cash': 'cash'}
        named = ', '.join(checks.get(c, c) for c in details.get('checks') or []) or 'your books'
        subject = 'Your CACU books need a check'
        body = (f"Today's check of your books found a difference in {named} (as of {_date(details['as_of'])}). "
                'Open your reports in CACU to see it, or ask your accountant. Nothing has been changed.')
    elif kind == 'suspended':
        subject = 'Your CACU workspace is read-only'
        body = f"Your CACU workspace is read-only until you pay. Nothing has been deleted. Pay to reopen it: {url}."
    else:
        raise ValueError('Unknown reminder')
    if channel == 'sms':
        return subject, f'CACU: {body}'
    return subject, f'Hello {business},\n\n{body}\n\nCACU Technologies Limited\n15 College Road, Ipaja, Lagos State'


def nigerian_number(raw) -> str | None:
    """Termii wants 234XXXXXXXXXX. Anything else is not sent."""
    digits = re.sub(r'\D', '', str(raw or ''))
    if len(digits) == 11 and digits.startswith('0'):
        digits = '234' + digits[1:]
    return digits if len(digits) == 13 and digits.startswith('234') else None


def _post(url: str, **kwargs) -> dict:
    try:
        with httpx.Client(timeout=15, follow_redirects=False) as client:
            response = client.post(url, **kwargs)
        body = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise SendFailed('provider_unavailable') from exc
    if response.status_code >= 300:
        raise SendFailed(f'provider_refused_{response.status_code}')
    return body if isinstance(body, dict) else {}


def send_email(to: list[str], subject: str, text: str, idempotency_key: str) -> str:
    body = _post('https://api.resend.com/emails', headers={'Authorization': f"Bearer {os.environ['RESEND_API_KEY']}",
                                                            'Idempotency-Key': idempotency_key},
                 json={'from': os.environ['CACU_EMAIL_FROM'], 'to': to, 'subject': subject, 'text': text})
    return str(body.get('id') or '')


def send_sms(to: str, text: str) -> str:
    base = (os.environ.get('TERMII_BASE_URL') or 'https://api.ng.termii.com').rstrip('/')
    body = _post(f'{base}/api/sms/send', json={'api_key': os.environ['TERMII_API_KEY'], 'to': to, 'from': os.environ['TERMII_SENDER_ID'],
                                               'sms': text, 'type': 'plain', 'channel': os.environ.get('TERMII_CHANNEL') or 'generic'})
    if not body.get('message_id'):
        raise SendFailed('provider_refused')
    return str(body['message_id'])


def configured_channels() -> list[str]:
    channels = []
    if os.environ.get('RESEND_API_KEY') and os.environ.get('CACU_EMAIL_FROM'):
        channels.append('email')
    if os.environ.get('TERMII_API_KEY') and os.environ.get('TERMII_SENDER_ID'):
        channels.append('sms')
    return channels


def send_due(limit: int = 50) -> dict:
    """Claim and send the queued reminders for each configured channel. A channel without keys stays queued."""
    channels = configured_channels()
    report = {'channels': channels, 'claimed': 0, 'sent': 0, 'failed': 0, 'skipped': 0}
    if not channels:
        return report
    with platform_transaction() as cursor:
        batch = call(cursor, 'SELECT platform.claim_notifications(%s,%s)', (channels, limit))
    report['claimed'] = len(batch)
    for item in batch:
        sent, provider_id, error = False, None, None
        try:
            subject, text = render(item['kind'], item['channel'], item['details'], item['business'] or 'there')
            if item['channel'] == 'email':
                if not item['emails']:
                    raise SendFailed('no_recipient')
                provider_id = send_email(item['emails'], subject, text, f"cacu-notification-{item['id']}")
            else:
                number = nigerian_number(item['phone'])
                if not number:
                    raise SendFailed('no_recipient')
                provider_id = send_sms(number, text)
            sent = True
        except SendFailed as exc:
            error = str(exc)
        except (KeyError, ValueError):
            error = 'unreadable_reminder'
        report['sent' if sent else 'skipped' if error == 'no_recipient' else 'failed'] += 1
        with platform_transaction() as cursor:
            cursor.execute('SELECT platform.finish_notification(%s,%s,%s,%s)', (item['id'], sent, provider_id, error))
    return report
