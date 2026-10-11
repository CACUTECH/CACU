# CACU Business Management Platform

CACU supports Nigerian MSMEs with product, service and hybrid workflows. The existing Next.js App Router application remains at the repository root; experimental Python accounting code is under backend/.

## Development checkpoint

The current branch adds a staged python-accounting 1.0.1 engine, explicit business selection, atomic native postings, account/document mappings, and an indirect cash-flow statement. Local PostgreSQL and browser component checks verify the acceptance fixture. Existing business workflows switch only after an explicitly reconciled cutover. Production activation, historical import, taxed/gateway workflows and Vercel preview verification remain release gates; this is not a production accounting release.

See [audit and architecture](docs/accounting-architecture.md), [schema reconciliation](docs/schema-reconciliation.md), [Python setup](docs/python-deployment.md), [checkpoint](docs/implementation-checkpoint.md) and [operations](docs/operations-guide.md).

## Setup

```bash
git clone https://github.com/CACUTECH/CACU.git
cd CACU
npm ci
npm run lint
npm run typecheck
npm test -- --runInBand
npm run build
npm run dev
```

Copy .env.example names into secure local environment configuration. Never commit credentials. Frontend auth uses the Supabase publishable/legacy anon key; secret service-role/database/provider credentials must never have NEXT_PUBLIC_ names. Ordinary PR CI uses non-secret placeholders.

Do not run docs/supabase_schema.sql as a production schema: it is a historical reference conflicting with the current services. The tracked migration currently requires an existing schema. Fresh installs need the reviewed baseline described in schema-reconciliation.md.

Keep Next.js, TypeScript, React, Tailwind, shadcn/Radix, Recharts, theme behavior, URLs, functioning exports and useful Genkit flows. HR/payroll/credit/storefront features must be assessed individually before making persistence, provider or statutory claims. No benchmark supports a million-user or constant-time authorization guarantee.
The staged python-accounting integration and Statement of Cash Flows are documented in [docs/python-accounting-cash-flow.md](docs/python-accounting-cash-flow.md). Production cutover and Vercel preview remain gated; see the documented limits and verification evidence.
