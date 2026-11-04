# CACU feature guide ? launch companion

Reviewed against the local repository on 2 November 2026. This describes implementation, not an assertion that every deployment has activated every provider or migration. The video uses illustrative data and recreated product screens.

| Area | What CACU provides | Availability / boundary | Source |
|---|---|---|---|
| Business workspace | Selected-business dashboard, income/profit/stock summaries, product/service/hybrid modes | Mode controls hide unsuitable workflows; accounting data needs setup | src/app/page.tsx; src/lib/business-mode.ts |
| POS | Inventory search/SKU lookup, cart, Cash/Transfer recording, sale receipt | Supported accounting cutover and receiving-account setup required for native postings; manual Transfer is not a live bank settlement guarantee | src/app/pos/page.tsx |
| Inventory | Item records, stock changes, adjustment approvals/history, protected attachments | Secure upload service and storage configuration required | src/app/inventory/page.tsx; approval-actions.ts |
| Inventory valuation | Moving-weighted-average policy, adoption, supplier-linked goods receipts, NRV adjustments/reversals, supported returns | Reviewed policy and dedicated accounts required; no FIFO engine; current branch implementation | src/app/inventory/valuation; backend/cacu/accounting/inventory.py |
| Catalogue | Products and services, categories and offering details | Business-mode and permission controls apply | src/app/catalog/page.tsx; src/components/catalog-workspace.tsx |
| Customers | Customer records and associated business information | Business scoped; settings/customers is a separate unavailable route | src/app/customers/page.tsx |
| Invoices & receipts | Invoices, estimates, credit documents, customer payments, receipts and exports | Native completed-obligation accounting requires delivery/completion evidence; no advanced revenue-recognition claim | src/app/invoices/page.tsx |
| Suppliers & bills | Supplier records, supplier bills, payments and party mappings after go-live | Native accounting needs reviewed mappings; no automatic bank payment execution | src/app/settings/suppliers; src/app/accounting/bills |
| Transactions & expenses | Income/expense records and supported native posting | Role and accounting activation restrictions apply | src/app/transactions; src/app/accounting/expenses |
| Accounting | Chart of accounts, journals, general ledger, trial balance and balanced posting | Reviewed chart plus separately approved business opening/cutover; no automatic activation from this video | src/app/accounting; backend/cacu/accounting |
| Financial reports | Income Statement, Balance Sheet, Cash Flow Statement; PDF/Excel exports | Management reporting for supported accounting data; not full IFRS certification | src/app/reports/page.tsx; src/components/financial-statements.tsx |
| Financial close | Policy evidence, equity/OCI, supporting schedules, review and independent approval controls | External schedules for ECL/assets/leases/tax/benefits; unfinished historical comparatives and IFRS 18 presentation remain gated | src/app/accounting/policies; backend/cacu/accounting/close.py |
| Cash policies | Reviewed cash classifications, eligibility/restrictions and financing roll-forward | Review/configuration required; not live bank feeds | backend/cacu/accounting/cash_rules.py; reports.py |
| Workforce | Employee details/history, attendance and monthly payroll drafts with approval | Owners/Admins only; no accounting posting or payout from payroll; no legal/statutory-compliance certification | src/app/hr/page.tsx |
| Users & access | Business roles, account/membership controls and audit history | Email delivery remains unimplemented under the agreed scope | src/app/settings/users; backend/cacu |
| AI assistant | Business questions with financial context and readiness checks | Requires configured server-side provider and approved model; not shown generating a fabricated answer | src/components/ai-assistant.tsx; src/app/ai/actions.ts |
| Banking | Reviewed receiving accounts for manual Transfer payments | No live bank feeds or automatic balance synchronization | src/app/settings/banks/page.tsx |
| Analytics | Analytics hub and top-selling report route | KPI, planning, budget-versus-actual, reconciliation and aging routes are unavailable; hub marketing is not evidence they work | src/app/analytics |
| Workspace preferences | Business settings and theme/appearance | Profile, locale and notifications settings remain unavailable | src/app/settings |
| Registration | Displayed compliance checklist | Static UI examples; not a verification service or proof of regulatory completion | src/app/settings/registration/page.tsx |
| Appointments & work orders | Navigation and mode-aware route visibility | Both currently display FeatureUnavailable; roadmap, not a live scheduling/work-order engine | src/app/appointments/page.tsx; src/app/jobs/page.tsx |
| Online storefront | Reserved module | Publishing and collections unavailable | src/app/storefront/layout.tsx |
| Offline & sync | Reserved module | Internet required; offline drafts/synchronization unavailable | src/app/settings/offline/page.tsx |
| Subscription billing | Reserved module | Plan changes and online billing unavailable; commercial rules excluded | src/app/settings/billing/page.tsx |
| Credit, community, external integrations | Reserved modules | Loan offers/borrowing, community and external-provider connections unavailable | src/app/credit; src/app/community; src/app/apps |

## Suggested product description
CACU connects daily business records with accounting and management reporting for Nigerian MSMEs. Manage sales, stock, customers, invoices and supplier bills; organise employees and attendance; review payroll drafts; and control access through business roles. Configured accounting supports balanced books and financial statements. A configured AI assistant helps answer business questions. Modules marked unavailable remain on the roadmap.

## Media provenance
- Wordmark and mark: original user-supplied CACU_logo.png.jpg and CACU20 (1).png, copied intact.
- Typefaces: app-bundled Space Grotesk and Inter; original font licences remain in the application.
- Music: Happy Beats / Business Moves vol. 12 by ende.app, bundled with brag.
- SFX: bundled interface drop and mouse click (Kenney asset family).
- Voice: synthetic Kokoro af_heart; not a real employee or customer.
- Screen figures and business records: invented solely for this illustrative film.
