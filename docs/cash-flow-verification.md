# Statement of Cash Flows verification

Story: a user selects an authorized CACU business and report dates, runs an authenticated Next Server Action, and receives a Python/library report from the same PostgreSQL ledger used by P&L, trial balance and balance-sheet cash. The screen and exports share those decimal strings.

| Boundary | Evidence | Limit |
| --- | --- | --- |
| UI rendering, comparison, drill-down, errors, CSV/Excel/PDF | Chromium component tests pass on actual CashFlowPage | Test-only Server Action double with fixture exported from PostgreSQL; not a live login |
| Next Server Action -> Python contract | TypeScript check and Next build pass; bearer and active-business adapter inspected | Live preview round trip not run |
| FastAPI -> restricted PostgreSQL -> JSON | Integration test hits report endpoint with cacu_runtime and real PostgreSQL; another business returns 403, invalid dates return 422 | External bearer verification and local TLS are replaced in this isolated test |
| Native posting and allocations | Real Postgres tests verify atomic rollback, partial/concurrent clearing, stable replay and immutable records | Local disposable schema; live Supabase migrations not applied |
| Financial acceptance fixture | Profit 25,000; operating -75,000; financing 1,000,000; cash 925,000; AR 30,000; inventory 70,000; difference 0 | Tax disabled, single-currency NGN |
| Deployment / live Supabase flow | Vercel project inspection returned 403; CLI starts login because no credentials exist | Preview and full-stack deployment remain blocked |

No production domains/data were changed. Native Linux dependencies also need a verified Vercel build. The complete flow cannot be declared verified until the preview, restricted database role/RLS and reconciled staging business are available. See python-accounting-cash-flow.md for cutover scope and remaining release gates.

Validation totals: 40 Python tests (16 using real PostgreSQL), 17 Jest tests, 3 Chromium tests. TypeScript and Next.js build pass; source lint has 327 pre-existing/style warnings and no errors. The pinned Python third-party lock audit reported no known vulnerabilities.
