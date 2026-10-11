# Python accounting integration and cash-flow release gates

The backend uses python-accounting **1.0.1**, SQLAlchemy **2.1.4**, Python **3.12**, and PostgreSQL. These versions were installed and tested together. The publisher specifies Python >=3.9. See [PyPI](https://pypi.org/project/python-accounting/), [upstream source](https://github.com/ekmungai/python-accounting), and [report documentation](https://python-accounting.readthedocs.io/en/latest/reports.html). Package identity and method signatures were checked against the installed source, not inferred from examples.

## Canonical ledger and schema decision

Live Supabase metadata was read successfully on 2026-10-11 for project fnkdzuolcbtckuvqcuai. Existing public.businesses/memberships/accounts/journal_entries/journal_lines all exist. accounts uses UUID IDs and broad asset/liability/equity/revenue/expense types; journal_entries uses date, posted/reversed status; journal_lines uses debit/credit numeric values. invoices uses lowercase draft/sent/paid/overdue/void, issue_date, and invoice_items.description/line_total. There are no supplier_bills or supplier_payments tables in the checked live metadata. Existing financial RPCs remain SECURITY DEFINER with unrestricted default execution in the inspected metadata; this implementation does not assume they enforce the new boundary.

The library requires integer inheritance IDs, its own entity/currency/period/account types, and a ledger of debit/credit legs. Its tables cannot be aliased directly onto CACU's UUID journals. Four additive migrations define a **private accounting schema**, stable mappings, restrictive privileges/RLS, deferred balance checks, immutable posted rows, and cutover guards. No migration has been applied to production. Offline DDL generation compiles installed metadata; no API/startup path calls Base.metadata.create_all().

For a staged business, old records remain authoritative. For an explicitly activated business, accounting.ledger is the **only writable financial ledger**. Existing journals and financial_transactions become immutable historical evidence; the Python adapter does not dual-write them. Source invoices, invoice_items, payments, transactions, transaction_items, and catalog_items remain existing public tables. The cutover guards also stop old SECURITY DEFINER RPCs from writing migrated financial records. Moving an existing record to another business cannot evade a guard.

Mappings:

| CACU identity | Library identity |
| --- | --- |
| public.businesses.id | accounting.business_map.entity_id |
| public.accounts.id | accounting.account_map.library_id; purpose and cash-flow policy |
| public.customers / suppliers UUID | accounting.party_map; a native RECEIVABLE / PAYABLE account |
| Source document UUID and type | accounting.document_map.transaction_id |
| Request UUID | posting_requests and workflow_request; payload hash and committed result |

Native Entity, Currency, ReportingPeriod, Category, Account, Transaction subclasses, LineItem, Assignment and CashflowStatement are used. The unused upstream user model is not an alternative login system; Supabase Auth and existing memberships remain authoritative. The explicit provisioning tool reuses businesses, accounts and counterparties, creates a staged entity/currency/categories/period, and never activates a business. From backend/, run `python -m tools.provision_entity mapping.json` without --apply first. Migration credentials are distinct from the runtime login.

## Posting boundary

The server validates Supabase bearer tokens and looks up current membership in PostgreSQL. The cacu_runtime login must be non-owner, non-superuser and NOBYPASSRLS; migrations initially create it NOLOGIN and do not embed a password. Every library table has a database business_id and forced RLS. Composite foreign keys enforce ownership across native model relationships, including inherited IDs. Caller tenant/claims/search_path are transaction-local; connections use NullPool, TLS verify-full and disabled prepared statements.

Upstream posting commits each ledger pair. AtomicAccountingSession.commit() flushes instead; the external SQLAlchemy connection owns the final commit. Posting, allocation, source status, stock cost, durable replay result and audit event share that transaction. Tests force a failure after native posting and confirm no rows survive. A per-business advisory transaction lock serializes numbering, request replay and concurrent allocations; current membership is locked with a narrowly granted private helper. Runtime posting cannot implicitly open fiscal periods.

Invoice totals and sale prices come from stored sources/catalog rows. Fulfillment must equal stored document quantities. Stock cost uses locked cost_price and posts a separate native inventory/COGS journal in the same transaction. The native Assignment mechanism clears invoices and supplier bills; a partial receipt does not recognize revenue again. Durable request keys remain stable in the UI through retry, and conflicting payloads return 409. Posted ledger, transaction, line and recyclable records cannot be edited. Supported simple journal reversals have one audited reversal mapping. Commercial/allocated documents use credit notes; arbitrary reversals of those documents are rejected.

Endpoints include /api/v1/businesses/{id}/postings, /invoices, /receipts, /sales, /journals, /invoices/balances, /reports/summary, and /reports/cash-flow. Server Actions authenticate and forward the active business session. Financial services switch only when public.accounting_mode confirms that business is active. There is no fallback to a legacy write after a migrated Python failure.

## Cash-flow policy

CashflowStatement(session, start_date: datetime, end_date: datetime) supplies structured balances/totals/result_amounts. The fixture proves its default classification and sign convention. The adapter retains native totals/results as diagnostic fields and derives traceable corrected indirect sections from the **same native ledger** and reviewed mappings; it never parses console text.

Net profit, non-cash operating adjustments and working-capital changes are separated from investing and financing. Each non-cash investing/financing leg is excluded with a supporting ledger adjustment, not an unexplained plug. Partial payments for capital purchases follow their actual native bill allocation. Transfers between included cash accounts contribute zero. Every account must be mapped; an unmapped leg produces a 409 rather than silently vanishing.

- Base currency: NGN only. Multi-currency entities are rejected; FX effects are explicitly zero under this policy. Actual FX support is a future release gate.
- Company dates: native naive timestamps represent business local wall time. Source financial dates are posted at local noon. Start date is inclusive and end date exclusive at the following local midnight. Reporting metadata identifies the configured company timezone, default Africa/Lagos. No UTC slicing of a supplied financial date is used in Python.
- Cash: only reviewed flow_section=cash accounts are included. Restricted accounts are excluded from equivalents and treated as investing transfers under this explicit policy.
- Overdrafts: borrowing is mapped as NON_CURRENT_LIABILITY/financing, not a BANK cash-equivalent account. A negative balance in an included cash account remains visible and requires review; it is not automatically reclassified.
- Taxes: the staged policy is **tax disabled**, matching the acceptance fixture. Taxed invoice creation is rejected. Do not activate an existing taxable business until its tax mappings/posting tests are implemented and reviewed. This restriction is explicit in business_map.tax_policy and migrated form labels.
- Interest: operating unless a reviewed account mapping explicitly classifies it elsewhere; the report removes the associated profit contribution from operating when reclassified.
- Dividends/owner contributions: financing via reviewed equity/dividend mappings. Mixed account use requires accountant review.
- Card/gateway payments: migrated manual receipt/POS endpoints reject Card; pending gateway rows cannot be promoted to success through them. Verified gateway settlement integration remains a release gate.

Opening cash + net movements + FX effect = calculated closing cash. Calculated cash is compared with independently summed posted cash legs, also used by the balance sheet. The JSON always exposes the difference and reconciliation status. The UI/export never plugs a difference or supplies demo values after failure.

## Historical cutover procedure

1. Apply the reviewed migrations to a disposable Supabase branch, compare actual grants/policies/triggers and schema to these assumptions, and validate the restricted role there.
2. Provision a staged business with explicit account/category/customer/supplier mapping. Reject ambiguous cash, inventory, COGS and revenue purposes. Configure existing and comparative reporting periods explicitly.
3. Export legacy journals, source documents, inventory costs, outstanding allocations and single-entry financial_transactions. Reconcile each source UUID. Preserve all originals.
4. Import reviewed balanced history into the native ledger with stable document mappings, or approved balanced opening journals supported by detailed reconciliation evidence. **A historical import/activation automation is not supplied; unresolved discrepancies block activation.** Do not invent equity or suspense to make balances agree. No Balance model writes are allowed at runtime.
5. Compare native trial balance, P&L, assets/liabilities/equity, cash, AR/AP, inventory, source status and report periods to the signed reconciliation. Detect double-counted legacy payments and incorrect historical stock costs before proceeding.
6. Confirm tax-free single-currency scope and no required gateway settlements for the first staged pilot. Record cutover_date and evidence, then activate only through a separately reviewed privileged change. Runtime cannot activate itself.
7. Run the complete staging Next.js -> Python -> Supabase flow and exports on Vercel preview. Only after it passes may production activation be considered. Production domains/data have not been changed.

## Verification and remaining delivery gates

Local PostgreSQL 17.11 was downloaded from the [official EDB binaries page](https://productsdl.enterprisedb.com/download-postgresql-binaries), bound to 127.0.0.1:55432, and used only as a disposable test cluster. The integration suite refuses non-local hosts and database names without an _test suffix. CI provides an isolated PostgreSQL service.

The NGN fixture with taxes disabled produces profit 25000.00, operating cash -75000.00, investing 0.00, financing 1000000.00, closing cash 925000.00, AR 30000.00, inventory 70000.00 and difference 0.00. Tests cover rollback, RLS tenant/actor/viewer rejection, replay conflicts, concurrent partial allocation, supplier payments, credit notes, simple reversals, immutable rows, compound journals, source/stock rollback, non-cash asset purchases, depreciation, transfers, and opening/comparative dates. API tests hit real PostgreSQL while replacing only the external bearer verification and local TLS transport; this is not a deployed Supabase Auth test.

Chromium component tests render the actual report page with a test-only Server Action double, using a JSON fixture exported from real PostgreSQL postings. They check loading, amounts, drill-down, comparison scope, clearing figures on errors and matching CSV, Excel and PDF exports. They do not claim to verify live authentication or the deployed full stack. The library emits upstream SQLAlchemy Cartesian-product warnings during provisioning; successful fixture tests do not establish statutory compliance.

Current external blockers: the Vercel connector returns 403 for the explicitly scoped cacu project; CLI credentials are absent. No preview has been deployed. python-accounting pins mysqlclient 2.3.0 and psycopg2 even though the adapter uses psycopg3. A CPython 3.12 manylinux binary-only probe found no mysqlclient wheel. Linux builds need pkg-config, MySQL/MariaDB headers and libpq build dependencies; CI installs these. Confirm them in the Vercel Python build or use a separately reviewed supported container setup; **Vercel compatibility is not yet proven**. Historical import/activation, taxed workflows, verified gateway settlements and commercial inventory-return reversals remain gated. The implementation is a tested staged integration, not an approved production cutover.
