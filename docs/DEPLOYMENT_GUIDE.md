# CACU deployment guide

No preview or production deployment has been verified for this branch. The connected Vercel project named cacu exists, but details and explicitly scoped CLI inspection are denied for team_1wa2SWkcHaqsq59sLpjnQI1x. Project-to-repository/domain relationship remains unverified. Supabase project listing works; SQL and migration inspection fail password authentication. Resolve access through platform configuration, never share secrets in chat.

Preserve the existing root Next.js deployment and www.usecacu.com. Python's separate project root is backend/. Follow [Python deployment](python-deployment.md). Confirm team/project/environment before creating previews. Use isolated test databases and non-secret fixtures; no production credentials in PR builds or npm install.

Release only after lint, independent TypeScript, Jest, Python, fresh/upgrade database, RLS/direct RPC/rollback/concurrency and browser end-to-end checks pass. Preview tests must cover session refresh, deep links, two-business isolation, source posting, downloads and Storage replacement permissions. An HTTP /health success proves only process availability.

Version migrations explicitly, inspect grants/policies/search paths, back up and test restoration before applying reviewed changes. Never execute migrations at application cold start. Financial cutover requires parity tests followed by disabling the legacy write path, not dual writes. See [operations](operations-guide.md).