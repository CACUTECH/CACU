# Python setup and deployment

Checkpoint only: validation API implemented, financial posting not implemented. Do not cut over production. The accounts.is_active lookup is a proposed schema requirement and must be reconciled to the actual accounts table before using this endpoint.

Local commands (Python 3.12):

```powershell
cd C:\Users\olayiwolao\CACU_NEW\backend
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.lock
.venv\Scripts\python.exe -m pytest
.venv\Scripts\python.exe -m uvicorn app:app --port 8000
```

Use .env.example placeholders through secure process/deployment environment configuration; the app does not automatically read .env files. /health confirms process availability only, not database readiness. No migration runs at startup. OpenAPI is at /openapi.json; backend/openapi.json is the reviewed generation source for src/lib/accounting-contract.ts. Regenerate with pinned openapi-typescript 7.10.1 after changing schemas.

Target deployment: existing Next.js project root remains repository root; create a separately confirmed Python project with root backend/. app.py exports app and pyproject declares the entrypoint. Current official guide: https://vercel.com/docs/frameworks/backend/fastapi . No preview was deployed; existing cacu project inspect is denied in both MCP and explicitly scoped CLI. Do not use an unrelated account or change www.usecacu.com.

Supabase Auth URL and publishable key go to Python, plus a restricted cacu_runtime DSN. This role must not be postgres/service_role, own tables or bypass RLS. Separate migration credentials. Schema/policy provisioning remains a release gate. Set PGSSLROOTCERT to the reviewed CA file and use sslmode=verify-full. psycopg uses one connection per request and prepare_threshold=None, matching transaction pooler constraints (https://supabase.com/docs/guides/database/connecting-to-postgres). Transaction-local claim/tenant settings do not themselves enforce RLS: reviewed policies and grants are still required. Connection-reuse and tenant-isolation tests remain pending against a real database.

Python accepts bearer authentication only, no auth cookies or credentialed CORS. The server-only Next adapter validates getUser, resolves active membership, then forwards the current access token from getSession. Python revalidates the token against Supabase Auth and membership from Postgres. Supabase SSR refresh cookies through the existing cookie adapter; test expired sessions on preview before deployment. Existing Server Actions retain Next origin protection. No frontend call site switches financial writes to Python yet.