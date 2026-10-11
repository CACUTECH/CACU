# CACU Business Management Platform

CACU supports Nigerian MSMEs with product, service and hybrid workflows. The existing Next.js App Router application remains at the repository root; experimental Python accounting code is under backend/.

## Development checkpoint

Branch feat/python-accounting-core starts from main cef3c01813033824644521bbe2d2bea99f4da228. Explicit active-business selection, scoped browser reads, decimal journal validation and Python authentication/repository scaffolding are implemented. Financial posting, canonical schema recovery, live authorization/concurrency tests and verified previews are still pending. This branch is not a production accounting release. Existing legacy financial workflows have not been migrated or declared safe.

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