import asyncio
from unittest.mock import AsyncMock, patch
from uuid import uuid4
import httpx
import pytest
from fastapi import HTTPException
from cacu.auth.session import verify_user

@pytest.mark.parametrize("status, expected", [(401, 401), (403, 401), (500, 503), (302, 503)])
def test_auth_failure_is_closed(monkeypatch, status, expected):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "non-secret-fixture")
    with patch("httpx.AsyncClient.get", new=AsyncMock(return_value=httpx.Response(status))):
        with pytest.raises(HTTPException) as error:
            asyncio.run(verify_user("untrusted-token"))
    assert error.value.status_code == expected

def test_auth_uses_verified_user_not_metadata(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "non-secret-fixture")
    user = uuid4()
    response = httpx.Response(200, json={"id": str(user), "user_metadata": {"role": "owner"}})
    with patch("httpx.AsyncClient.get", new=AsyncMock(return_value=response)) as request:
        assert asyncio.run(verify_user("fixture-token")) == user
    assert request.call_args.args[0] == "https://example.supabase.co/auth/v1/user"

def test_missing_configuration_is_unavailable(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    with pytest.raises(HTTPException) as error:
        asyncio.run(verify_user("anything"))
    assert error.value.status_code == 503