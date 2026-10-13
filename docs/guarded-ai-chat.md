# Guarded OpenAI general-guidance chat

This slice connects the selected OpenAI transport to a new authenticated Q&A action and a tenant-scoped chat panel. It is a general-guidance pilot, not financial analysis or an employee/document agent. Existing legacy insight/HR generation actions remain unavailable; no journal, payment, policy or employee mutation is exposed to the model.

## Data and authorization boundary

The new actions verify the user with the existing server context and current membership rows, and compare the client business ID with the server-selected business. The service accepts only a UUID business/request key and a trimmed question of at most 2,000 characters; extra fields are rejected. Current owner/admin/editor/viewer memberships may ask general questions. No paid-plan or permission-bundle rules are introduced.

The sole source projection is `businesses.business_type`, scoped to the authorized business and restricted to PRODUCT/SERVICE/HYBRID. The provider receives that category in server instructions and the explicit user question. No business/user identifiers or names, ledger amounts, stock, customers, employee data, raw page text or prior conversation are supplied as context. Users may still type sensitive information; the panel explains the provider transfer and asks them not to include confidential records. Privacy and provider review are required before activation.

The existing OpenAI adapter fixes the endpoint, disables SDK logging/automatic retries, sets a 20-second timeout, bounds input/output and requests `store:false`. This is not a claim of Zero Data Retention. Model text is displayed as escaped text, not executable HTML. Answers can be inaccurate; the UI labels them general guidance and requires user review. Prompt instructions discourage invented records and attempts to override the system, but semantic correctness/prompt-injection resistance still needs real-model evaluation.

Membership and identity are rechecked after provider I/O. The database completion function also verifies current membership. Revoked/deleted users, changed identity, shutdown or unconfirmed completion suppress the answer. These are point-in-time checks, not revocation of already delivered content or a guarantee that every revoked Auth session immediately invalidates its token.

## Shared operational controls

Migration `20261012132427_guarded_ai_chat.sql` creates a private, forced-RLS schema with an administrator-owned singleton setting and metadata-only request reservations. Browser roles have no table grants; identity-checked private definers use fixed safe search paths and authenticated invoker wrappers. Anonymous execution is revoked.

Default settings are disabled with no approved model. The reviewed pilot defaults are 3 requests per actor per rolling minute, 20 per actor per rolling 24 hours, 50 per business per rolling 24 hours and 100 globally per rolling 24 hours. All reservations, including failed or interrupted ones, count. Indexed counts and a short pilot-wide transaction lock make limits shared across processes and concurrent requests; no database lock spans provider I/O. These are operational abuse/capacity controls, not commercial plan entitlements or an exact currency spending cap. Review worst-case costs for the selected model and maintain OpenAI project usage controls too. This serialized design is for a small pilot, not a scale benchmark.

Actor/request keys are durable and bound to business, model, context version and question fingerprint. Only the first reservation can invoke the model; repeated keys return a duplicate status, and changed payload/model/tenant is rejected. There is no automatic retry of an uncertain provider call. Database browser entrypoints can consume their own/shared reservation capacity, but cannot invoke a provider or read other users' metadata; authenticated capacity exhaustion remains an operational abuse scenario to monitor.

No prompts or answers are stored in PostgreSQL or browser persistent storage. Metadata includes actor/business UUIDs, request key, fingerprint, model, timestamps and status. These identifiers are not anonymous data. Metadata is intentionally not cascaded away on business/user deletion, so deletion cannot refund the current shared limit. Privacy/retention and privileged cleanup must be approved; never delete rows within the rolling budget window to reset capacity. There is no automatic metadata purge in this change. Response persistence/outbox and recovery would require a separately reviewed retention design.

## Browser behavior and recovery

The panel waits for authenticated deployment/database readiness before showing a question input. Messages are held only in component memory, limited to five recent question/answer pairs. Each question is independent; prior messages are not sent to OpenAI. Clear chat removes visible history. Changing user, business or role remounts the panel; late results from an old panel are ignored. Business-provider refresh/navigation can also clear the in-memory panel. Closing the sheet does not cancel a model request already sent.

An interrupted response keeps the original question/key and freezes editing. Retry same request reuses that key. A duplicate reservation does not call the model again, but the answer cannot be recovered because it is not stored. New question explicitly clears the attempt and creates a fresh key on the next submission; it can consume another slot/request. Refreshing the page loses in-memory keys, so do not treat a new submission as recovery of an old response. Failed, unconfirmed or revoked results are never displayed as a successful answer.

## Required staging setup outside this chat

1. Review this draft after the OpenAI provider draft. No hosted migration, deployment, credentials or activation settings were changed here.
2. Recover/verify the complete staging baseline, including public businesses/memberships and auth.users. Apply the CLI-generated migration through the migration workflow before deploying this frontend. Run database advisors and inspect grants/search paths. Do not use the conflicting legacy schema document as a complete baseline.
3. Complete [OpenAI account/key/model setup](openai-setup.md) and run the explicit synthetic connection test. The repository's local .env still lacks the OpenAI variables; no live provider call has been verified here.
4. Review the operational caps, model costs, accepted data scope and metadata retention. In the isolated staging database, a trusted administrator can set the exact approved model and enable settings:

```sql
UPDATE ai_private.settings
SET allowed_model = 'your-approved-model-id', enabled = true
WHERE singleton = true;
```

Use the same actual model ID as `OPENAI_MODEL`. Review any cap adjustments instead of relying on commercial blueprint limits. There is no browser write access to these settings.

5. Set server-only `OPENAI_API_KEY`, `OPENAI_MODEL` and `CACU_AI_ENABLED=true` in the reviewed Next.js staging environment, then redeploy. `.env.example` defaults the switch to false. No provider secret belongs in NEXT_PUBLIC variables or the accounting/upload backend. Environment switch, provider configuration and database enabled/model setting must all agree; missing migration/configuration fails closed.
6. Verify real Auth → selected membership → verified category → atomic reservation → OpenAI → fresh membership/completion → escaped answer. Test missing/expired/deleted identity, foreign/revoked business, different role, simultaneous/different keys, every shared cap, provider timeout and database interruption. Verify switching businesses clears old chat and cannot display late answers. Evaluate fabricated-figure, prompt-injection and private-data questions against the actual approved model; local mocks do not establish output quality.
7. Approve production rollout separately. To stop new calls, set `CACU_AI_ENABLED=false` and/or database `enabled=false`; in-flight provider calls cannot be unsent. Database disable also prevents successful completion. Review monitoring and metadata cleanup/retention before production use. Financial/HR analysis and action generation remain outside this slice.

## Validation

Disposable PostgreSQL tests exercise shared caps, same/different-key concurrency, failed-attempt charging, rolling-window recovery, model binding, foreign/revoked/deleted identities, completion shutdown, metadata grants and deletion without quota refunds. Frontend tests exercise direct-call authorization, input limits, safe context projection, setup/reservation failures, duplicate suppression, provider errors and post-I/O identity/membership checks. Mobile Chromium covers stable-key retries, explicit new-question intent, clearing history and ignoring old-business answers. Full existing accounting/upload/setup suites remain part of the regression run.

Final verification: 158 Python tests (including 16 isolated AI PostgreSQL cases), 116 unique frontend tests, 12 Chromium cases, TypeScript and production build passed. The final submission-guard change also passed the two affected browser cases. Repository lint passed with zero errors and 261 existing warnings. OpenAI API/key and model are still missing from local .env and the pilot switch is off; provider responses were mocked and no hosted end-to-end or live-model evaluation was performed.
