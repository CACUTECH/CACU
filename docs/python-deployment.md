# Python accounting setup and deployment

See [integration, mappings, policies and release gates](python-accounting-cash-flow.md). The backend now uses native python-accounting 1.0.1 and exposes posting/report APIs; each business requires an explicitly reconciled cutover before using them. No startup DDL or production activation occurs.

Python 3.12 local setup:

```powershell
cd C:\Users\olayiwolao\CACU_NEW\backend
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.lock
.venv\Scripts\python.exe -m pytest
.venv\Scripts\python.exe -m uvicorn app:app --port 8000
```

For real integration tests, set CACU_TEST_DATABASE_URL to a disposable localhost PostgreSQL database ending _test. The tests replace its public/accounting schemas and never use CACU_DATABASE_URL for that purpose. GitHub CI supplies a disposable service. Browser checks: npm run test:browser after npx playwright install chromium.

Provide SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, CACU_DATABASE_URL and PGSSLROOTCERT securely. The app does not load .env files automatically. Runtime DSN must log in as cacu_runtime with the installed role/RLS boundary; production never permits postgres, owner or BYPASSRLS credentials. Set Next's CACU_ACCOUNTING_API_URL to the confirmed HTTPS backend endpoint. Next is still rooted at the repository root; Python is a separate backend project rooted at backend/.

/health only checks process availability. OpenAPI is /openapi.json. Regenerate committed backend/openapi.json from app.openapi(), then generate src/lib/accounting-contract.ts using openapi-typescript 7.10.1.

Vercel preview remains blocked: connector project inspection returned 403 for team_1wa2SWkcHaqsq59sLpjnQI1x/cacu; the CLI has no credentials. Native mysqlclient/psycopg2 dependencies also need a verified Linux build environment. Do not claim preview compatibility, alter an unrelated team/project, or change existing production domains. The target architecture remains Next.js + separate FastAPI + existing Supabase; see [Vercel FastAPI](https://vercel.com/docs/frameworks/backend/fastapi) and [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres).

Vercel recognizes the committed `pyproject.toml` + `uv.lock`. All resolved dependencies are constrained to the versions tested in `requirements.lock`; `uv lock --check` verifies consistency. See [Vercel Python dependency support](https://vercel.com/docs/functions/runtimes/python) and [uv constraints](https://docs.astral.sh/uv/reference/settings/#constraint-dependencies). Linux native compilation and deployment remain unverified until preview access is restored.
