# Native bank collection implementation

Review-only follow-up to legacy financial integrity. Commercial packaging and permission bundles remain pending review. No hosted database migration, account mapping, credential provisioning, tenant activation or deployment was performed.

## Resulting behavior

Native invoice receipts and POS sales distinguish Cash from Transfer. Cash uses the unique reviewed `cash` purpose mapping. Transfer requires an explicit source account UUID mapped with `purpose=bank`, `flow_section=cash`, native BANK classification, current entity currency and active source status. Foreign-business, inactive, unmapped, deleted, restricted/non-cash and incompatible accounts fail before commitment. Card collection continues to require verified gateway settlement.

The bank list is authenticated, business-scoped and restricted to eligible mappings; it returns account IDs/names only, with a maximum of 100 accounts. It does not expose external account numbers, credentials or sample balances. Checkout and invoice payment forms share accessible method/account fields. The Bank Accounts settings page replaces fabricated linked banks, balances and synchronization claims with the real eligible list and an explicit statement that live feeds are not connected.

Ledger collection legs, posting results and audit details carry the selected account and manual method. Receipt source rows distinguish `cash` and `transfer`. Native POS now writes lowercase source methods as required by the real source schema. Partial allocations do not create new invoice revenue. Cash-flow balances include both reviewed cash and bank accounts, and continue to reconcile with posted ledgers.

Receipt retry keys include the selected bank in the workflow payload. A changed bank conflicts with a committed request. Existing committed Cash workflow and generic posting hashes remain compatible when newly added fields are absent. Fresh generic receipt/POS postings must declare Cash or Transfer and pass the same collection-account checks; omitting the method cannot bypass selection. Older committed Transfer requests without a selected bank can replay their original result but never move historical postings to a new account. After an ambiguous receipt response, the dialog preserves and locks the original amount/method/bank/key for replay, including close/reopen during the current page session. A confirmed rejection on the first attempt unlocks correction while retaining the request key. A later rejection cannot erase an earlier ambiguous attempt; reconcile or restore authorized replay before clearing it. Browser refresh persistence and a durable outbox remain separate work.

## Narrow locking migration

`20261011113113_native_collection_account_lock.sql` adds the private `accounting.lock_collection_account` function. The restricted runtime only reads public source accounts and mapping configuration; PostgreSQL row-lock operations otherwise require update privileges. This definer locks only the authorized membership and selected account/mapping/entity rows, with explicit tenant context, current owner/admin/editor membership, active entity, classification and currency checks. It grants execution only to `cacu_runtime`, revokes PUBLIC/browser execution, fixes the search path, and grants no new table-update permission. Existing RLS and native cutover guards remain in force.

The function protects collection posting from concurrent account deactivation/reclassification until the outer transaction commits. The actual operation is still performed by the restricted runtime with its tenant and actor context. The staging database owner must review and apply the migration before deploying the backend: new Cash workflows also call this helper.

## Setup outside this chat

1. Review and apply the additive locking migration to an isolated staging schema matching the existing CACU tables and native mappings. The earlier access and legacy-integrity migrations remain separate rollout prerequisites; do not treat historical schema documents as a fresh baseline.
2. An accounting administrator must review the actual receiving accounts. Existing source account UUIDs must belong to this business; native mappings must use BANK classification and the same NGN currency/entity. Maintain one `purpose=cash` mapping for physical cash and separate `purpose=bank` mappings for actual receiving bank accounts. Multiple reviewed bank mappings are supported. Account labels alone are not authorization or accounting classification.
3. For a newly staged entity, the privileged provisioning tool supports mapping entries such as:

```json
{"id":"EXISTING_SOURCE_ACCOUNT_UUID","account_type":"BANK","flow_section":"cash","purpose":"bank"}
```

Run its dry run first, then review the complete mapping and opening reconciliation before any privileged apply. The tool does not activate a tenant. For an already provisioned entity, review a targeted administrative mapping change; do not rerun entity provisioning or silently relabel historical cash as bank. Previously misclassified Transfer postings need reviewed corrections and reconciliation, not automatic history rewriting.
4. Deploy the matching Python backend after the migration, then deploy Next.js. Existing `.env` configuration remains applicable; `CACU_ACCOUNTING_API_URL` must point to the backend. No live banking provider secret is needed for manual collection. Runtime login, TLS certificate, hosted authentication and activation gates in [external setup](external-setup.md) still apply.
5. Verify hosted checkout and partial/full invoice receipts with two distinct bank accounts, stale/foreign/inactive IDs, role changes, retries, source records, ledger/account balances and reports. Approve the account mapping and staging results before production deployment or activation. Bank feeds, automatic transfer verification and card/gateway settlement need separate integration work.

## Validation

Full Python suite: 130 passed against disposable PostgreSQL, including 33 native integration tests using `cacu_runtime` (133 existing upstream warnings). Tests cover selected-bank vs cash ledger balances, receipt allocation without extra revenue, reconciled cash flow, lowercase POS methods, immutable replay, prior Cash hash compatibility, foreign/inactive/deleted/restricted accounts, current-role checks, browser grant denial, and account-deactivation lock contention.

Frontend: 49 Jest tests passed; TypeScript and production build passed. Seven Chromium component tests passed, including mobile Transfer selection, close/reopen after response loss, identical retry payload and blocking Transfer without accounts. Focused React lint has no errors and 23 existing warnings in the large invoice/POS pages; new picker/dialog/settings/action files have no warnings. Repository-wide lint passed with no errors and 307 existing warnings. The production build retains existing lint and optional OpenTelemetry warnings. Component/API mocks and local database tests do not establish hosted end-to-end release readiness.

Current database access guidance was checked against [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security); schema grants and tenant policies remain separate checks.
