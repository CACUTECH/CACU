> See [29 October suite execution review](suite/repository-review-20261029.md) for the new document comparison, R0 honest-state fixes and remaining review gates.

> See [production feature readiness](production-feature-readiness-20261014.md) for the HR directory implementation and remaining activation requirements.

> See [14 October technical completion review](technical-completion-20261014.md) for delivered follow-up fixes and remaining external blockers.

# Implementation review — 13 October 2026

Reviewed current main against the six blueprint documents, the implementation checkpoint, inventory/user management notes, upload rollout and external setup requirements. Earlier checkpoints describe their dated baselines; they are not current completion claims. Commercial rules remain proposals and email delivery remains unimplemented by the user's decision.

## Current evidence

Catalog/user-management improvements, saved inventory adjustment history and protection of referenced item structure are merged. CI browser regressions were corrected without removing retry or version assertions. The approved production upload configuration repair redeployed both services at the existing reviewed commit; the private metadata table and buckets are present. Backend health, missing/invalid-session denial and frontend unauthenticated file denial passed. A signed-in image upload and preview remain acceptance work; no live files were created during verification. The custom frontend domain showed a separate TLS certificate mismatch; its verified Vercel alias works. See [upload repair evidence](inventory-upload-configuration-repair.md).

## Outstanding work

| Area | Remaining work | Required outside this implementation |
| --- | --- | --- |
| Schema/recovery | Complete pre-0001 schema baseline, fresh installation and representative restore proof | Approved isolated staging database, schema-only export, backup/restore ownership and RPO/RTO |
| Accounting | Hosted invoice/receipt/report parity, reviewed cash/bank and inventory mappings, historical reconciliation and activation | Restricted runtime credentials/TLS certificate and accountant sign-off; do not infer native activation from migrations |
| Inventory/users | Signed-in upload acceptance, location scope beyond membership organization, further conflict/accessibility checks | Real business acceptance; financial branch segregation needs separate schema/workflow review |
| Upload operations | Hourly orphan/quarantine cleanup, alerting and object restore checks | Authorized worker and server credentials; retain existing business files |
| Auth/domains | Recovery/callback/revocation acceptance and custom-domain TLS repair | Supabase redirect configuration and domain/certificate operator; email delivery stays unimplemented |
| Further product slices | Customer credit splits/terms, multi-invoice allocation/advances, as-of ageing, supplier AP settlement, purchases and commercial returns | Reviewed financial contracts and staged reconciliation; preserve historical documents |
| Offline/integrations/HR | Offline pending drafts/conflict handling, durable provider events/outbox and salary-field projections | Provider consent, privacy/permission decisions and statutory review |
| Reports | Bounded financial lists, report pagination and measured read-lock contention | Staging data/performance evidence and financial reconciliation |
| AI | General-guidance staging activation, real-model acceptance, retention approval and permission-filtered fact projections | Approved provider/billing/model settings and synthetic evaluation; sensitive generation stays unavailable |
| Commercial/product | Plan packaging, Hybrid eligibility, seat/document/AI quotas, permissions bundles, tax/costing/gateway policies | Explicit business/accounting review before implementing or activating these rules |
| Operations | Retention approvals, monitoring and load evidence, targeted dependency reachability review | Operational owner and reviewed environment; no blanket dependency upgrades |

No old migration should be rerun solely because a dated document says it was pending. Check actual staging/production migration history and apply only reviewed missing versions.

## Selected next implementation: recover uncertain user-management actions

Form saves already retain their exact request for retry. Direct deactivate/reactivate, invitation renewal and cancellation did not retain it, so an interrupted response could leave the manager without a safe replay action. These direct actions now preserve the same operation, item, version, details and request key until the server confirms success or definite rejection. A visible retry control recovers the original command; competing mutations are blocked. Confirmed rejection releases the request so a reviewed new attempt can use a new key. Existing form retry behavior is retained.

This is a frontend recovery fix using the existing management action and database replay contracts. It adds no schema, API, dependency, privilege, commercial rule or email provider. Browser tests cover uncertain response recovery for all three direct commands and definite rejection recovery, alongside existing inventory/user and financial regressions. No production rollout is authorized by this next-implementation request; submit a draft review first.

Rollback this frontend change independently; preserve all existing memberships, invitations, audit and replay records. No database or data rollback is required.

## Validation for this slice

127 Jest tests and 25 browser tests passed, including inventory, invoice receipts, cash flow, authentication/setup, attachments and user-management flows. TypeScript and the production build using the existing private `.env` passed. Repository lint reported zero errors and 241 existing warnings. No backend, SQL or production configuration changed in this implementation; browser server actions are explicit test doubles, so these tests do not claim hosted acceptance.
