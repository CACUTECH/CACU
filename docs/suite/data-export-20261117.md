# Full data export (Doc 10 E22 part 2, FR-192)

**Where it comes from in the specification:**
- Doc 11 lists `POST /exports` and `GET /exports/{id}`: a full data export run as a job.
- Doc 14 SUB-10 keeps exports working while a workspace is suspended. Every plan includes exports (`module.export`).
- Doc 19:
  - TEST-009: a member of another business, or anyone after expiry, is denied.
  - TEST-410 and NFR-035: a full export finishes within an hour.

**Owner decision of 9 November 2026:** the accounting API may read the business tables it could not read before (staff, payroll, appointments and the like), but only for the business being exported, and only while its export runs.

## What the owner gets

**Settings › Export your data** (`/settings/export`):

- **Preparing an export:** **Prepare export** queues one. The export job runs every 10 minutes, so it is usually ready well within the hour. The page refreshes itself while it waits.
- **Limits:** one export at a time, and at most three a day per business.
- **The file:** one ZIP:
  - Under `public/`, one CSV per business table: sales, invoices, customers, suppliers, stock, purchases, staff, payroll, appointments, jobs, uploads list and the rest.
  - Under `accounting/`, one CSV per table of the books: payments, refunds, credit notes, bills, advances, stock values, shifts and approvals.
  - `general_ledger.csv`: every posted entry with date, transaction number, narration, account code and name, debit and credit.
  - `README.txt`: what is in the export, with the row count of each file.
  - The CSVs carry a byte-order mark, so Excel shows the naira sign correctly.
- **Left out:**
  - The ledger library's raw tables (replaced by the general ledger).
  - Internal maps and request keys.
  - The sealed Paystack key, link tokens and invitation tokens.
  - Raw gateway events and notification logs.
  - Any column named like a secret, token, hash, cipher, password, signature, API key or webhook.
  - Stored files themselves (only the list of uploads).
- **Kept seven days, then deleted.** Downloading needs `settings.export` in that business.
- **Who:** `settings.export`. By default only the Owner holds it, and the Owner can grant it to someone else. Admins do not have it, because the file holds payroll and every customer's details.
- **Suspended workspaces:** exports keep working (SUB-10).
- **Audit:** asking and each download are recorded in the audit log.

## How it is built

The export job (`tools/run_data_exports.py`; workflow **Data exports** every 10 minutes, off until `CACU_EXPORTS_ENABLED` is `true`) takes each waiting export:

1. **Start:** a short transaction marks it running. It acts for the person who asked as a server job, and only if they still hold `settings.export`.
2. **Read:**
   - One read-only, repeatable-read transaction reads every table into the ZIP, so the files agree with each other.
   - It does not take the business lock that writes use, so the business keeps selling while it runs.
   - The statement limit is 10 minutes.
3. **Save:** a short transaction stores the file, its SHA-256, size, row counts and the expiry date.

**When something goes wrong:**
- A failure marks the export **Not prepared** with a plain reason.
- A run that stopped part way is failed after an hour, so the owner can ask again.
- Files past their seven days are deleted.
- Over 200 MB fails with "contact CACU support".

**Where the file lives:** in `accounting.data_export`, inside the database, behind the same row-level security as the books. It never goes to a public bucket.

**How the API reads the extra tables:**
- The migration grants the runtime role SELECT on the business tables in `public` it could not read (30 in production).
- It adds a policy `export_read` to every business table in `public`. The policy is true only inside a running export of that business (`accounting.exporting`), acting for its requester while they are still an active member.
- Outside an export, the API sees exactly what it saw before.
- Row-level security stays on. A table without it would be skipped; in production, all 49 have it.

## Database

Migration `20261117090000_data_export.sql`:
- **`accounting.data_export`:**
  - It only moves forward (queued, running, ready or failed, then expired). Who asked, and when, never change.
  - One active export per business.
  - Row-level security is forced.
- **Runtime-only definer functions:** `accounting.exporting`, `accounting.export_queue` and `accounting.export_settle`.
- **The grants and `export_read` policies** described above.

## API

| Method and path | Who |
|---|---|
| `POST /businesses/{id}/exports` (`request_key`) | `settings.export`, also while read-only |
| `GET /businesses/{id}/exports` and `/exports/{export}` | `settings.export` |
| `GET /businesses/{id}/exports/{export}/download` | `settings.export`. Returns 410 after seven days |

The web app's `/api/exports/{id}` passes the ZIP on, with the signed-in person's own session, never cached.

## Setup (not done by this change)

1. **Apply the migration** (`supabase db push`).
2. **Turn on the job:** set the repository variable `CACU_EXPORTS_ENABLED=true`. It uses `CACU_DATABASE_URL` from the `billing-operations` environment, which is already set.
3. **Check production read-only after the push:** `export_read` exists on the business tables, and the runtime role can read none of their rows outside an export.

## Tests

- **`test_data_export_postgres.py` (3):**
  - Only the Owner asks, and a retry asks once.
  - One at a time.
  - The job's dry run and build.
  - The ZIP: customers, a record the API could not read before, every member, a balanced general ledger, nothing secret and no left-out tables.
  - TEST-009: another business's member, and someone without the permission, cannot download.
  - The extra tables are invisible outside a running export.
  - Expiry with 410, the file deleted, and no going back.
  - A stopped run failed; three a day.
- **Jest `data-export-ui` (4):** sizes, preparing and downloading, limits and failures, and no permission.

**Not measured here:** TEST-410's one-hour target for a business with 12 months of records needs production-sized data. Time the first real exports.
