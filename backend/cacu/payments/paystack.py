"""Paystack calls made with a business's own secret key (Doc 11 PaymentProvider). CACU's own billing key is never used
here, and the key is never logged."""
import hashlib
import hmac
import re
from datetime import date
import httpx
from fastapi import HTTPException

API = 'https://api.paystack.co'
SECRET = re.compile(r'^sk_(test|live)_[A-Za-z0-9]{20,100}$')


class Paystack:
    def __init__(self, secret: str):
        if not SECRET.fullmatch(secret or ''):
            raise HTTPException(422, 'That is not a Paystack secret key. It starts with sk_live_ or sk_test_.')
        self.secret = secret

    @property
    def mode(self) -> str:
        return 'live' if self.secret.startswith('sk_live_') else 'test'

    def signature_valid(self, raw: bytes, signature: str | None) -> bool:
        if not signature:
            return False
        expected = hmac.new(self.secret.encode(), raw, hashlib.sha512).hexdigest()
        return hmac.compare_digest(expected, signature)

    def _request(self, method: str, path: str, missing_ok: bool = False, **kwargs):
        try:
            with httpx.Client(base_url=API, timeout=15, follow_redirects=False,
                              headers={'Authorization': f'Bearer {self.secret}'}) as client:
                response = client.request(method, path, **kwargs)
            body = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise HTTPException(502, 'Paystack could not be reached. Try again shortly.') from exc
        if response.status_code == 401:
            raise HTTPException(422, 'Paystack did not accept this secret key.')
        if missing_ok and response.status_code in {400, 404} and body.get('status') is False:
            return {'data': {'status': 'not_found'}}
        if response.status_code != 200 or not body.get('status') or 'data' not in body:
            raise HTTPException(502, 'Paystack refused the request.')
        return body

    def check_key(self) -> None:
        """A cheap authenticated call: a wrong or revoked key fails here, before it is saved."""
        self._request('GET', '/transaction', params={'perPage': 1})

    def initialize(self, *, reference: str, amount_kobo: int, email: str, callback_url: str | None, metadata: dict) -> str:
        payload = {'email': email, 'amount': amount_kobo, 'currency': 'NGN', 'reference': reference, 'metadata': metadata,
                   'channels': ['card', 'bank', 'ussd', 'bank_transfer']}
        if callback_url:
            payload['callback_url'] = callback_url
        data = self._request('POST', '/transaction/initialize', json=payload)['data']
        url = data.get('authorization_url') if isinstance(data, dict) else None
        if not isinstance(url, str) or not url.startswith('https://'):
            raise HTTPException(502, 'Paystack refused the request.')
        return url

    def verify(self, reference: str) -> dict:
        """The only source of truth for a payment: never the redirect or the webhook body (Doc 11)."""
        data = self._request('GET', f'/transaction/verify/{reference}', missing_ok=True)['data']
        return data if isinstance(data, dict) else {}

    def settlements(self, start: date, end: date) -> list[dict]:
        data = self._request('GET', '/settlement', params={'from': start.isoformat(), 'to': end.isoformat(), 'perPage': 100})['data']
        return [s for s in data if isinstance(s, dict)] if isinstance(data, list) else []

    def settlement_transactions(self, settlement_id: str) -> list[dict]:
        data = self._request('GET', f'/settlement/{settlement_id}/transactions', params={'perPage': 500})['data']
        return [t for t in data if isinstance(t, dict)] if isinstance(data, list) else []
