import base64
import json
import os
from contextvars import ContextVar
from uuid import UUID
import httpx
from fastapi import HTTPException

# The assurance level of the request's session (Doc 16 SEC-014): 'aal2' after two-step sign-in, else 'aal1'. Set by
# verify_user for the request; the database decides with it whether the person may use a business (authz.mfa_ok).
session_level: ContextVar[str] = ContextVar('session_level', default='aal1')


def token_level(token: str) -> str:
    """The aal claim of a token Supabase Auth has just accepted. Only read after that check, never trusted alone."""
    try:
        payload = token.split('.')[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
    except (IndexError, ValueError):
        return 'aal1'
    return 'aal2' if isinstance(claims, dict) and claims.get('aal') == 'aal2' else 'aal1'


async def verify_user(token: str) -> UUID:
    """Validate against the configured Supabase Auth server, never JWT metadata."""
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")
    if not url.startswith("https://") or not key:
        raise HTTPException(503, "Authentication unavailable")
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
            response = await client.get(
                f"{url}/auth/v1/user",
                headers={"Authorization": f"Bearer {token}", "apikey": key},
            )
        if response.status_code in (401, 403):
            raise HTTPException(401, "Invalid or expired session")
        if response.status_code != 200:
            raise HTTPException(503, "Authentication unavailable")
        user = UUID(response.json()["id"])
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        raise HTTPException(503, "Authentication unavailable") from exc
    session_level.set(token_level(token))
    return user
