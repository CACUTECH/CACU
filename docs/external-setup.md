# Setup outside this chat

As of 11 October 2026. This checklist accompanies [the blueprint review](blueprint-review.md); placeholders are not real credentials. Store secrets in your password manager and hosting environment settings, never in Git or a chat reply.

## 1. Supabase runtime database login

Read-only inspection confirms cacu_runtime exists with NOLOGIN, NOSUPERUSER and NOBYPASSRLS. An authorized database administrator needs to enable LOGIN and set a unique strong password for **that role**, retaining its existing restrictions. Do this in the approved project's SQL Editor or secure administrator session. Do not use postgres, the schema owner or the Supabase API service-role key as the accounting login.

Copy host/port/database details from Supabase **Connect**. Start with the **Session pooler** for the existing SQLAlchemy connection policy, and follow [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres). The pooler username commonly includes the project reference; use the exact dashboard format for the custom role, not an invented host.

```dotenv
CACU_DATABASE_URL=postgresql://cacu_runtime.PROJECT_REF:URL_ENCODED_PASSWORD@SESSION_POOLER_HOST:5432/postgres?sslmode=verify-full
```

URL-encode the password. Obtain the database CA certificate through Supabase, bundle it without its private key at a known backend-readable path, and set PGSSLROOTCERT to that path. The backend transaction code also requests verify-full and reads PGSSLROOTCERT. Never bypass SSL verification to conceal a connection error. Confirm actual logged-in role properties before a pilot.

Enabling login does not activate a business ledger. Accountant-approved reconciliation, provisioning tools and signed opening evidence remain separate steps.

## 2. Two Vercel projects and environment settings

Confirm the owning team/project in Vercel. Frontend root is the repository root; Python backend root is **backend**, FastAPI app is **app:app**, Python is **3.12**. Native-driver build fix PR #7 is merged into inspected main 71ba8d0. Use the committed pyproject.toml and frozen uv.lock; do not switch to pip installation that reinstalls excluded drivers.

Sign in locally with `vercel.cmd login` or reconnect the Vercel app to the intended team if automated access is needed. Prior connector inspection returned 403; hosted deployment success has not been established by this review.

Configure only the relevant variables per project:

| Project | Variables | Source / handling |
|---|---|---|
| Next frontend | NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY | Public project URL/key; intended for browser use |
| Next frontend | CACU_ACCOUNTING_API_URL, CACU_UPLOAD_API_URL | Confirmed backend HTTPS base URL, no /api/v1; both may use the same backend |
| Python backend | SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY | Map from matching public Supabase settings; backend naming differs |
| Python backend | CACU_DATABASE_URL, PGSSLROOTCERT | Restricted role connection and CA path from step 1 |
| Python backend | CACU_STORAGE_SERVICE_ROLE_KEY | Authorized Storage service-role key, confined to Python Storage operations |
| Future enabled AI server | Approved provider key/model settings | Provision only after identity/quota/provider validation; not a browser key |

Local .env is your requested source, but Vercel project environment settings must be populated explicitly. NEXT_PUBLIC names are publicly bundled. SUPABASE_ACCESS_TOKEN is a CLI management credential, not an application runtime variable. CLAUDE_MODEL/ANTHROPIC_API_KEY are not used by the existing Google Genkit adapter just because they exist in .env. Do not copy every local variable into both projects. .env and .env.local remain ignored.

After deployment, GET /health proves process availability only. Exercise login, authorized report requests, and private uploads with real memberships; verify foreign business and revoked/viewer failures. A 409 for unreconciled accounting is a deliberate release gate, not a reason to use privileged credentials.

## 3. Staging database, schema inventory and access migration

Create/confirm a separate staging Supabase project or database branch and sandbox provider credentials. Export **schema only** with constraints, roles/grants, policies, triggers, enums and migration history; exclude records and secret values. Recover missing pre-0001 schema and test fresh installation plus representative upgrades/restores. Do not run docs/supabase_schema.sql as the production baseline.

Review 20261011102406_harden_legacy_function_access.sql, test it on staging and inspect function grants/search_path afterward. It closes anonymous privileged calls and viewer financial mutations; it does not fix every legacy pricing/stock/payment defect. Production application is a separate review decision. All earlier upload/native migrations were already present in the inspected project.

## 4. Storage operations and recovery

Both new upload buckets and the inspected legacy buckets are private. Keep historical objects/references until a reviewed migration; do not delete them to make the new UI work. Schedule the backend operator task `python -m tools.cleanup_uploads --apply` hourly in an authorized worker with its backend environment. Retry and alert on cleanup_required failures. First inspect the command without --apply; it does not replace an approved retention policy.

Create database and object backups, rehearse restoring them and reconcile cash, debt, stock and source links. Record actual RPO/RTO. Configure error/latency and storage-cleanup alerts without logging secrets or raw financial payloads.

## 5. Authentication, product and accounting approvals

Set Supabase Auth site URL/allowlisted recovery and callback URLs to the confirmed frontend domains, configure verified email delivery, and test sign-in/recovery/revocation end to end. Review commercial packaging, permission bundles, mode transitions, privacy/retention and provider use with the owners of those decisions. Confirm supported tax-free NGN pilot businesses and have an accountant sign opening cash/bank/AR/AP/stock reconciliation before native activation.

Billing providers, AI context, online collections, payroll, taxable transactions and weighted-average costing are separate capabilities requiring implementation and validation; dashboard configuration alone cannot enable them safely.

## Reviewed native bank collection

Follow [native bank collection setup](native-bank-collection.md) before deploying that follow-up. Apply the private locking migration in staging before the backend, review separate cash/bank mappings and opening reconciliation, then deploy Next.js and verify selected-bank postings. Existing cash accounts must not be silently reclassified to rewrite past Transfer mistakes. Live bank feeds and automatic settlement verification remain unconnected.
