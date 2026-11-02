"""Paystack calls for CACU subscriptions. The secret key comes from the environment and is never logged."""
import hashlib
import hmac
import os
import httpx
from fastapi import HTTPException

API = 'https://api.paystack.co'


def secret_key() -> str:
    key = os.environ.get('PAYSTACK_SECRET_KEY', '')
    if not key.startswith(('sk_test_', 'sk_live_')):
        raise HTTPException(503, 'Billing unavailable')
    return key


def signature_valid(raw: bytes, signature: str | None) -> bool:
    if not signature:
        return False
    expected = hmac.new(secret_key().encode(), raw, hashlib.sha512).hexdigest()
    return hmac.compare_digest(expected, signature)


def _request(method: str, path: str, **kwargs) -> dict:
    try:
        with httpx.Client(base_url=API, timeout=15, follow_redirects=False,
                          headers={'Authorization': f'Bearer {secret_key()}'}) as client:
            response = client.request(method, path, **kwargs)
        body = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(502, 'Payment provider unavailable') from exc
    if response.status_code != 200 or not body.get('status') or not isinstance(body.get('data'), dict):
        raise HTTPException(502, 'Payment provider refused the request')
    return body['data']


def initialize(email: str, amount_kobo: int, reference: str, metadata: dict) -> str:
    payload = {'email': email, 'amount': amount_kobo, 'currency': 'NGN', 'reference': reference, 'metadata': metadata}
    callback = os.environ.get('CACU_BILLING_CALLBACK_URL', '')
    if callback.startswith('https://'):
        payload['callback_url'] = callback
    url = _request('POST', '/transaction/initialize', json=payload).get('authorization_url')
    if not isinstance(url, str) or not url.startswith('https://'):
        raise HTTPException(502, 'Payment provider refused the request')
    return url


def verify(reference: str) -> dict:
    """The only source of truth for a payment: Paystack's verify endpoint, never the redirect or the webhook body."""
    return _request('GET', f'/transaction/verify/{reference}')
