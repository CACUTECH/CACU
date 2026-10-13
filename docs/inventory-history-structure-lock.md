# Preserve inventory history when stock reaches zero

Previously, a product could change its type, stock unit or tracking setting after its balance reached zero, even when opening stock or corrections were already recorded. This increment preserves the meaning of those records: saved inventory movements now lock those structural fields alongside the existing on-hand stock, invoice and sale checks. The same private predicate supplies the API's `structure_locked` flag and the database trigger, keeping browser controls and write authorization aligned.

The product edit form disables type, stock unit and tracking once history exists and explains the restriction. Name, category, code, price, notes and archive/reactivate remain editable under existing rules. Unused items with zero stock and no recorded references can still change structure. No item, movement, journal, balance, invoice, membership or audit row is rewritten.

## Migration and deployment

Review and apply `20261013073115_inventory_history_structure_lock.sql` in staging after the existing inventory/user-management migration, then deploy the reviewed frontend. The migration is transactional and updates two existing private function definitions plus one shared private predicate. It creates no tables, performs no data backfill or row updates, changes no public API signature and grants no extra browser permissions. Existing reference indexes support the existence checks. No new environment variable or dependency is required. Production migration and deployment are not performed in this chat.

Owners/Admins needing a different type/unit for a referenced item should archive it and create a new item with the intended structure, retaining the old item's history. Continue to correct quantities through the existing reasoned adjustment workflow. Do not rewrite old entries to unlock an item.

Rollback the frontend independently if necessary, retaining the database guard. Old clients attempting a structural change receive the existing `ITEM_STRUCTURE_LOCKED` error; ordinary edits remain compatible. Prefer a forward fix over restoring the old function definitions, which would reopen the defect. Never drop history or reverse journals to roll back this migration.

Email delivery remains unimplemented and commercial/tax rules remain pending review.

## Verification

Real disposable PostgreSQL cases cover exhausted stock with opening/correction history, browser RPC and restricted native runtime rejection, ordinary metadata/archive changes, unused-item changes, preserved rows and private execute grants. Browser checks verify disabled structure controls and enabled name/price controls. An existing user-management test fixture was missing its saved version; the fixture was restored without weakening the version assertion. Validation: 33 disposable PostgreSQL tests, 127 Jest tests and all 20 browser tests passed. TypeScript and the production build using `.env` passed; lint reported zero errors and 241 existing warnings.
