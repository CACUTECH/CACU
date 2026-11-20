"""A business's Paystack secret key at rest: AES-256-GCM under CACU_PAYMENT_KEY_ENCRYPTION_KEY, bound to the business.

The database only ever holds the ciphertext. The key never appears in logs, errors or API answers; screens see a hint
such as sk_live_...a1b2.
"""
import base64
import binascii
import os
from uuid import UUID
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import HTTPException

VERSION = b'\x01'
UNAVAILABLE = 'Online payments are not set up on this server yet. Ask CACU support.'


def _cipher() -> AESGCM:
    encoded = os.environ.get('CACU_PAYMENT_KEY_ENCRYPTION_KEY', '')
    try:
        key = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        key = b''
    if len(key) != 32:
        raise HTTPException(503, UNAVAILABLE)
    return AESGCM(key)


def seal(business_id: UUID, secret: str) -> str:
    nonce = os.urandom(12)
    sealed = _cipher().encrypt(nonce, secret.encode(), b'cacu:paystack:' + str(business_id).encode())
    return base64.b64encode(VERSION + nonce + sealed).decode()


def unseal(business_id: UUID, ciphertext: str) -> str:
    cipher = _cipher()
    try:
        raw = base64.b64decode(ciphertext, validate=True)
        if raw[:1] != VERSION:
            raise ValueError('unknown version')
        return cipher.decrypt(raw[1:13], raw[13:], b'cacu:paystack:' + str(business_id).encode()).decode()
    except (binascii.Error, ValueError, InvalidTag) as exc:
        # A wrong server key or a record moved between businesses: never guess, and never show the ciphertext.
        raise HTTPException(503, 'The saved Paystack key cannot be read. An Owner or Admin should connect Paystack again.') from exc


def hint(secret: str) -> str:
    prefix = secret[:8]
    return f'{prefix}...{secret[-4:]}'
