# CACU implementation instructions

Continue only in CACUTECH/CACU from the checkpoint in implementation-checkpoint.md. Preserve existing Next.js App Router URLs, themes, product/service/hybrid workflows and working Genkit/export functionality. Do not scaffold a replacement application.

Treat architecture/audit evidence as the starting point, not proof of live behavior. Recover reviewed businesses/memberships/accounts/journal_entries/journal_lines schema before database-dependent implementation. Never run the obsolete docs/supabase_schema.sql against production. Keep roles owner/admin/editor/viewer; authorization uses current memberships, not editable metadata.

Complete Phase 1 schema/privilege/tenant/RPC/database invariants and real tests before migrating the invoice/payment/journal/report slice. Use Python Decimal and decimal-string contracts; database numeric, atomic source/journal/audit posting, durable tenant idempotency, period locks and immutable posted entries. Do not dual-write or invent balancing offsets. Validate stock withdrawals, service handling and original-cost returns under concurrent transactions.

Use explicit active-business context on every read/write, independent bearer verification in Python, restricted TLS database credentials and transaction-local authorization. No production credentials in ordinary CI. Preserve existing domains until authorized cutover.

AI context must use authorized structured report data, not page innerText. Keep existing useful Genkit flows; protect actions with current membership, input/output validation and rate/cost limits before exposure. Suggestions must never post entries without an explicit authorized action. Provider/statutory/plan details require verification, not invented claims.

Document delivered features, failing checks, unavailable environments and the next vertical slice precisely. Do not mark phase completion using mock isolation tests or planned migrations. Update release/operations evidence and create a reviewable PR only after checks and repository authorization; never merge automatically.