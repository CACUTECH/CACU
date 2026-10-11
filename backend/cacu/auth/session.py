import os
from uuid import UUID
import httpx
from fastapi import HTTPException

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
        return UUID(response.json()["id"])
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        raise HTTPException(503, "Authentication unavailable") from exc