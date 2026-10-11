from uuid import UUID
from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
import psycopg
from cacu.auth.session import verify_user
from cacu.repositories.context import authorized_transaction
from cacu.schemas.journal import JournalDraft, JournalValidation
from cacu.services.accounting.journal import validate_journal

app = FastAPI(title="CACU Accounting API", version="0.1.0")
bearer = HTTPBearer(auto_error=False)

class BodyLimit:
    def __init__(self, app, max_bytes=131072):
        self.application, self.max_bytes = app, max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in {"POST", "PUT", "PATCH"}:
            return await self.application(scope, receive, send)
        messages, size = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            size += len(message.get("body", b""))
            if size > self.max_bytes:
                return await JSONResponse(status_code=413, content={"detail": "Request too large"})(scope, receive, send)
            messages.append(message)
            if not message.get("more_body", False):
                break
        async def bounded_receive():
            if messages:
                return messages.pop(0)
            return await receive()
        await self.application(scope, bounded_receive, send)

app.add_middleware(BodyLimit)

@app.exception_handler(RequestValidationError)
async def invalid_request(request, exc):
    # Do not echo payloads, account IDs or validation exception objects into logs/responses.
    return JSONResponse(status_code=422, content={"detail": "Invalid accounting request"})

@app.exception_handler(psycopg.Error)
async def database_error(request, exc):
    return JSONResponse(status_code=503, content={"detail": "Accounting database unavailable"})

async def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> UUID:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(401, "Bearer authentication required")
    return await verify_user(credentials.credentials)

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/v1/businesses/{business_id}/journals/validate", response_model=JournalValidation)
def validate(business_id: UUID, draft: JournalDraft, user_id: UUID = Depends(current_user)):
    with authorized_transaction(user_id, business_id, write=True) as cursor:
        # Validate account ownership/status against authoritative records.
        # account schema is an explicit verification gate; missing columns fail closed.
        for line in draft.lines:
            cursor.execute("SELECT id FROM public.accounts WHERE id = %s AND business_id = %s AND is_active = true", (line.account_id, business_id))
            if not cursor.fetchone():
                raise HTTPException(422, "Invalid posting account")
        return validate_journal(draft)

# No posting route: database posting boundary is not yet reviewed or installed.