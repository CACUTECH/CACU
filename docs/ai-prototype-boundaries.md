# AI prototype access and availability

The reviewed prototype exported three provider-backed server actions with no verified identity or membership checks. The assistant copied `main.innerText` into the model request and claimed it had already analyzed the page. Accounting policies displayed sample definitions as active and showed a successful master-ledger save without any persistence call. HR onboarding/departure screens also offered prototype document and delivery controls without a verified record/approval workflow.

This slice retires the three generation paths without removing their exported action names/types. They now use the existing verified-user/selected-membership context, reject missing, revoked, foreign or ambiguous membership, and return a fixed unavailable error for legitimate callers. HR calls additionally require current owner/admin membership; browser role/tier metadata cannot override it. No provider modules are imported, no model requests are made, and browser payloads are neither logged nor forwarded. The private-data payloads remain accepted only for compatibility with older callers and are unused.

The assistant is now an accessible availability sheet without page scraping, message history, prompts or send controls. Accounting-policy and HR document screens use the existing unavailable component. They do not claim saved policies, active sample accounting methods, generated documents, deliveries or completed employee workflows. The legacy Genkit adapter file/dependencies remain as inactive development infrastructure; no retired action imports them. This is defect remediation, not a launched AI feature, provider migration, or approval of commercial quotas. Other HR/accounting workflows require their own review.

## Review and setup outside this chat

- Review this draft after the preceding business-setup draft; it is stacked on that branch. Rebuild/deploy the reviewed frontend to close the current production entrypoints. No deployment or hosted database change was performed here, and no new migration is required by this slice.
- Verify signed-out, invalid-session, foreign/revoked membership, ambiguous business selection and HR viewer/editor direct calls in staging, using real Supabase Auth. Verify authorized calls report unavailable and no external provider requests occur. The current session-authority helper uses `getUser` and current membership rows; session-revocation guarantees still depend on the existing Auth/session configuration.
- Before implementing or enabling AI, review the provider/model, data-processing terms and allowed inputs. Replace the inactive hard-coded adapter through a separately reviewed change; environment keys alone do not activate the feature. Do not bulk-copy local provider keys to deployments for this slice.
- Implement server-derived, permission-filtered facts and bounded input/output, operational rate/token/cost limits, timeouts and cancellation. Commercial seat/document/AI entitlements remain pending user review; operational abuse controls should be designed separately.
- Define retention/logging, tenant-bound conversation lifecycle, prompt-injection evaluations and output review. AI accounting/HR drafts require human approval and must not post journals, apply policies, save employee decisions or send documents automatically.
- Build real policy storage, versioning, permissions and audit history, and HR record/approval/delivery workflows before restoring their editing/generation controls. An unavailable screen is not evidence those workflows are implemented.

## Validation

Direct action regressions cover all three exports: missing identity, authentication errors, selected foreign/revoked membership, lookup failure, ambiguous and absent membership, unknown roles with forged claims, legitimate owner/admin unavailable responses, and HR editor/viewer denial. A provider-module sentinel fails if the retired actions initialize provider infrastructure. UI tests check unavailable status and absence of confidential input/fake save controls. Mobile Chromium verifies the assistant opens/closes without POST requests or prompts and policies show no active sample/editor controls. These tests are local boundaries and component checks; hosted Auth acceptance remains external. The read-only hosted metadata check confirmed memberships RLS remains enabled; no business records were read.

Current Supabase guidance was checked against the [SSR client documentation](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs) and [changelog](https://supabase.com/changelog). No SDK migration or new Supabase feature was needed for this slice.

Validation results: 85 Jest tests passed; all ten unique Chromium cases passed (the policy locator was corrected and its two availability cases rerun); TypeScript, focused lint and the production build using local .env passed. Repository lint has zero errors and 261 remaining warnings. Backend/accounting code was not changed, so the existing 142-test Python result from the preceding slice was not rerun or claimed as new validation here.

## OpenAI follow-up

OpenAI was subsequently selected by the user. The Google default module is replaced by the server-only OpenAI adapter; retired public actions remain closed. Follow [OpenAI setup](openai-setup.md) for API project configuration and the connection check.
