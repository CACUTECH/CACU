"""Paystack signature and key handling for CACU billing (Doc 14 SUB-03, TEST-202)."""
import hashlib
import hmac
import pytest
from fastapi import HTTPException
from cacu.billing import paystack

BODY = b'{"event":"charge.success","data":{"id":1}}'


def test_signature_is_hmac_sha512_of_the_raw_body(monkeypatch):
    monkeypatch.setenv('PAYSTACK_SECRET_KEY', 'sk_test_non-secret-fixture')
    good = hmac.new(b'sk_test_non-secret-fixture', BODY, hashlib.sha512).hexdigest()
    assert paystack.signature_valid(BODY, good)
    assert not paystack.signature_valid(BODY + b' ', good)
    assert not paystack.signature_valid(BODY, good.upper()) and not paystack.signature_valid(BODY, None)


@pytest.mark.parametrize('key', ['', 'pk_test_public-key-by-mistake', 'not-a-key'])
def test_billing_is_unavailable_without_a_secret_key(monkeypatch, key):
    monkeypatch.setenv('PAYSTACK_SECRET_KEY', key)
    with pytest.raises(HTTPException) as refused:
        paystack.signature_valid(BODY, 'x')
    assert refused.value.status_code == 503
