# Source security findings

Baseline cef3c01813033824644521bbe2d2bea99f4da228. Findings below come from source inspection. Live function definitions/grants/policies could differ; SQL inspection failed. No data leakage or successful exploit is asserted.

| Source | Finding | Current disposition |
| --- | --- | --- |
| supabase/migrations/0001_init.sql process_sale | SKU lookup/update lacks business filter; caller totals/prices trusted; duplicate lines checked separately; service rows treated as stock | pending reviewed SQL repair + real concurrency tests |
| same, create_invoice_atomic | customer/catalog reference ownership not validated; arbitrary status/totals accepted | pending reviewed SQL and transition guards |
| same, record_payment_atomic | lacks invoice lock/allocation bound; marks paid for partial amount; receipt creates Income | pending accrual-aware atomic allocation path |
| same, get_business_kpis | SECURITY DEFINER without membership guard | pending direct-call/grant/search-path repair |
| same, public privileged functions | no fixed search_path or explicit least-privilege execute grants in tracked definitions | pending complete live inventory |
| src/services/ledger-service.ts | separate insert then best-effort audit; single-entry ledger | pending canonical journal cutover; unchanged write path |
| src/services/inventory-service.ts | catalog upsert permits direct stock overwrite | pending audited stock movement replacement |
| src/services/invoice-service.ts | arbitrary status update exposed to server action | pending authorized transitions |
| storage in migration | SELECT/INSERT/DELETE but no replacement UPDATE policy | pending live grant/policy inspection; unrelated buckets untouched |
| BaseService/BusinessProvider/browser reads | first/single membership assumption and missing business filters | selection/filter source repair delivered; live RLS/browser acceptance pending |
| .github/workflows/ci.yml | production service-role/Gemini credentials exposed to ordinary PR validation environment | removed from this branch; no claim about historical credential exposure |
| accounting pages | journal success without persistence; sample balances/suspense | false save removed, fabricated balances removed, unfinished actions disabled |

Remaining legacy functions/Data API writes can bypass a future Python posting service unless privileges and posting guards are repaired at cutover. The presence of this API scaffold is not a security remediation for those paths.