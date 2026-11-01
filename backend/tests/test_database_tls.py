from pathlib import Path
import ssl
from unittest.mock import patch
from uuid import uuid4
import pytest
from fastapi import HTTPException
from cacu.database_tls import database_connect_options, BACKEND_ROOT
from cacu.repositories.context import authorized_transaction
from cacu.accounting.session import library_transaction


def test_bundled_public_ca_works_independently_of_working_directory(monkeypatch, tmp_path):
    monkeypatch.delenv('PGSSLROOTCERT', raising=False)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('PGSSLMODE', 'disable')
    options = database_connect_options()
    assert options['sslmode'] == 'verify-full'
    assert Path(options['sslrootcert']) == BACKEND_ROOT / 'certs/supabase-root-2021.crt'
    assert ssl.create_default_context(cafile=options['sslrootcert']).cert_store_stats()['x509_ca'] == 1
    assert 'PRIVATE KEY' not in Path(options['sslrootcert']).read_text()


@pytest.mark.parametrize('override', ['', 'certs/supabase-root-2021.crt'])
def test_default_and_relative_paths_are_absolute(monkeypatch, override):
    monkeypatch.setenv('PGSSLROOTCERT', override)
    assert Path(database_connect_options()['sslrootcert']).is_absolute()


def test_absolute_certificate_override_is_preserved(monkeypatch, tmp_path):
    certificate = tmp_path / 'reviewed-ca.crt'
    certificate.write_bytes((BACKEND_ROOT / 'certs/supabase-root-2021.crt').read_bytes())
    monkeypatch.setenv('PGSSLROOTCERT', str(certificate))
    assert database_connect_options()['sslrootcert'] == str(certificate.resolve())


def test_missing_override_fails_closed_without_revealing_path(monkeypatch, tmp_path):
    monkeypatch.setenv('PGSSLROOTCERT', str(tmp_path / 'private-directory/missing.crt'))
    with pytest.raises(HTTPException) as error:
        database_connect_options()
    assert error.value.status_code == 503
    assert error.value.detail == 'Accounting TLS certificate unavailable'


def test_direct_psycopg_receives_verified_ca_options(monkeypatch):
    monkeypatch.setenv('CACU_DATABASE_URL', 'postgresql://fixture@localhost/unused')
    monkeypatch.delenv('PGSSLROOTCERT', raising=False)
    with patch('cacu.repositories.context.psycopg.connect', side_effect=RuntimeError('stop before network')) as connect:
        with pytest.raises(RuntimeError):
            with authorized_transaction(uuid4(), uuid4()): pass
    assert connect.call_args.kwargs == database_connect_options()


def test_sqlalchemy_receives_verified_ca_options(monkeypatch):
    monkeypatch.setenv('CACU_DATABASE_URL', 'postgresql://fixture@localhost/unused')
    monkeypatch.delenv('PGSSLROOTCERT', raising=False)
    with patch('cacu.accounting.session.create_engine', side_effect=RuntimeError('stop before network')) as engine:
        with pytest.raises(RuntimeError):
            with library_transaction(uuid4(), uuid4()): pass
    assert engine.call_args.kwargs['connect_args'] == database_connect_options()
