"""Verified database TLS with a deployment-relative, bundled public CA."""
import os
from pathlib import Path
from fastapi import HTTPException

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def database_connect_options() -> dict:
    override = os.environ.get('PGSSLROOTCERT', '').strip()
    certificate = Path(override) if override else Path('certs/supabase-root-2021.crt')
    if not certificate.is_absolute():
        certificate = BACKEND_ROOT / certificate
    if not certificate.is_file():
        raise HTTPException(503, 'Accounting TLS certificate unavailable')
    return {'sslmode': 'verify-full', 'sslrootcert': str(certificate.resolve()),
            'prepare_threshold': None, 'connect_timeout': 10}
