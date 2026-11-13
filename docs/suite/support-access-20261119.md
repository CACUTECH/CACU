# Support access (Doc 10 E22 part 4, FR-212)

**Where it comes from in the specification:**
- **Doc 08 THR-08 and §4:** platform staff have no standing access to tenant data. Support access is time-bound, granted by the Owner, and audited.
- **Doc 16 T-12:** insider access by CACU staff.
- **Doc 07:** the `ops` schema holds support access grants.
- **Doc 17 RB-09:** grant and revoke support access to a business.

**Owner decisions of 13 November 2026:**
- The Owner grants access each time, for one support case. They choose 1 hour, 24 hours, 3 days or 7 days. There is no open-ended window. (This answers Doc 08's open question.)
- Support access is read-only.
- Staff and pay records are included only when the Owner ticks them for that grant.

## What happens

**Settings › Support access** (`/settings/support`, Owner only):
- The Owner says what support should look at, picks how long, and can tick "Include staff and pay records".
- While access is live, the page says until when, and has **End access now**. Ending takes effect at once.
- **History** lists every grant, every ending, and every time someone from CACU support opened the business, with their name and the time.

**Support cases** (`/support`, CACU support staff only):
- Shows the businesses whose Owner has granted access now, with the reason and end time.
- Needs two-step sign-in. Without it, the page sends the person to set it up.
- **Open** records the opening, then switches the app to that business. A blue banner on every page says "You are viewing this business as CACU support, read-only, until …".

## How it is enforced

All of this is in the database (`supabase/migrations/20261119090000_support_access.sql`), so the Data API, the business functions and the accounting API all meet it.

- **Who is support:** `ops.support_staff`, kept by the operator (below). Being on the list gives no access by itself.
- **When they can read:** only with a live grant (not ended, not expired) that they have opened, from a session that passed the second step (aal2). The check is `authz.support_case`.
- **What they can read:**
  - `authz.has_permission` accepts the case for `*.view` permissions only. `hr.view` is accepted only when the Owner ticked staff and pay records. HR tables are readable only through `hr.view` or the Owner/Admin role, so pay stays hidden otherwise.
  - `is_business_member` accepts the case. `has_business_role` accepts it only where viewers are admitted, never where only Owners, Admins or Editors are.
  - The accounting API sees the business's rows (`accounting.authorized`), and its membership check names the caller `support`.
- **Nothing that writes accepts it:**
  - Write permissions and write roles never match a support case.
  - The accounting API refuses `support` on every write, including what a read-only workspace may still do: "CACU support access is read-only."
  - A trigger on every public table with a `business_id` refuses any row change by a CACU support account in a business it is not a member of (`SUPPORT_READ_ONLY`). This also covers the older routes that only check membership, such as the audit-log function and the notifications insert policy.
- **The record:** `ops.support_event` is append-only. Browsers cannot read the `ops` tables; the Owner sees them through `support_access_status`.

**Not shown to support:** pages that read through the staff and settings management functions (staff list, permissions, billing), uploaded attachments, and other members' profile names. These stay Owner-and-staff only.

## Runbook RB-09: adding and removing CACU support staff

1. The person signs up to CACU with their own work account and turns on two-step sign-in.
2. Find their account id in Supabase (Authentication › Users).
3. From `backend/`, with the runtime database connection:
   - add: `python -m tools.support_staff add --user-id <id> --name "Tolu (CACU support)"`
   - remove (when they leave support): `python -m tools.support_staff remove --user-id <id>`
   The name is what Owners see in their history. The tool prints only the count of active support staff.
4. To help a business, ask its Owner to grant access in Settings › Support access, then open the case at `/support`.

## Tests

- `backend/tests/test_support_access_postgres.py`:
  - Owner-only grants, lengths and reasons; one live grant at a time.
  - Nothing before the case is opened, or without the second step.
  - View permissions only, and pay only when ticked.
  - The patched membership checks.
  - The accounting API reads and refuses writes.
  - The row trigger refuses inserts and deletes.
  - Ending, expiry and removal from support all stop access at once.
  - The history, and the operator tool.
- `backend/tests/test_definer_access_postgres.py`: the five browser-callable functions are reviewed, and refuse other tenants.
- `src/tests/security/support-access-ui.test.tsx`: the Owner's page, the support page, the banner, and the switcher only offering opened cases.
