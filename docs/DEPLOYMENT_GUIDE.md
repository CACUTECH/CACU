# CACU deployment guide

No preview or production deployment has been verified. Vercel project inspection returns 403 for team_1wa2SWkcHaqsq59sLpjnQI1x/cacu, and the CLI has no credentials. Read-only Supabase SQL metadata inspection now works for fnkdzuolcbtckuvqcuai; no production migrations have been applied. Native Python dependency build support, staged schema/cutover and the deployed authenticated flow remain release gates. See [current integration and evidence](python-accounting-cash-flow.md).

Preserve the existing root Next.js deployment and www.usecacu.com. Python's separate project root is backend/. Follow [Python deployment](python-deployment.md). Confirm team/project/environment before creating previews. Use isolated test databases and non-secret fixtures; no production credentials in PR builds or npm install.

Release only after lint, independent TypeScript, Jest, Python, fresh/upgrade database, RLS/direct RPC/rollback/concurrency and browser end-to-end checks pass. Preview tests must cover session refresh, deep links, two-business isolation, source posting, downloads and Storage replacement permissions. An HTTP /health success proves only process availability.

Version migrations explicitly, inspect grants/policies/search paths, back up and test restoration before applying reviewed changes. Never execute migrations at application cold start. Financial cutover requires parity tests followed by disabling the legacy write path, not dual writes. See [operations](operations-guide.md).