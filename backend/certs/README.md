# Supabase database CA

supabase-root-2021.crt is the public CA supplied by the project owner from Downloads/prod-ca-2021 (1).crt. It contains no private key. Subject: Supabase Root 2021 CA. Expires 26 April 2031. DER SHA-256: 807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa.

Both Python database connection paths use this bundled CA by default with sslmode=verify-full. No PGSSLROOTCERT environment variable is required. Optional PGSSLROOTCERT overrides accept absolute paths or paths relative to the backend project root, for example certs/supabase-root-2021.crt. Never use a developer Windows path on Vercel. A missing explicit override fails closed rather than falling back silently.

The Vercel Python project root is backend; keep certs in that project. Python Functions include project files by default: https://vercel.com/docs/functions/runtimes/python. Certificate verification also checks hostname: https://www.postgresql.org/docs/17/libpq-ssl.html. Do not disable TLS verification to hide a connection error.

This change supplies trust configuration, not database credentials or ledger activation. Configure Production CACU_DATABASE_URL privately with the restricted cacu_runtime login, enable that role with its own strong password, then redeploy the backend and verify a signed-in report. Never commit the database password or connection URL. Owner/Admin still approve actual opening balances and account mappings before activation.

Rollback: revert application code independently if required; preserve the public CA and existing environment overrides. No data or schema migration is involved.

Validation on 1 November 2026: 18 targeted TLS/API/auth tests passed; full available backend suite passed 67 tests with 311 database integrations explicitly skipped because local PostgreSQL timed out. No production login or signed-in report acceptance is claimed. The live runtime role is enabled and remains nonsuperuser/non-BYPASSRLS; the Production backend database URL and local .env database URL were both absent when checked. CI must exercise its disposable PostgreSQL integrations.
