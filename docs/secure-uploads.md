# Secure uploads

Implemented in `feat/secure-file-uploads`, based on the existing accounting/report branch. Production Storage configuration is unchanged until this migration is applied to the intended project.

## Paths and policy

| Purpose | Existing/new control | Allowed formats | Input/output limit | Dimensions / pixels | Write roles | Resource |
| --- | --- | --- | --- | --- | --- | --- |
| Logo | Setup picker; Business Settings logo manager | PNG, JPEG | 2 MiB | 2048 maximum side; 1,048,576 pixels | owner/admin | Current business |
| Receipt | Transaction Receipts dialog | PNG, JPEG | 3 MiB | 4096 maximum side; 4,194,304 pixels | owner/admin/editor | Existing same-business transactions or financial_transactions row |
| Invoice attachment | Billing document Attachments dialog | PNG, JPEG | 3 MiB | 4096 maximum side; 4,194,304 pixels | owner/admin/editor | Existing same-business invoices row |

All members may read approved files; only owner/admin may delete them. Unknown purpose, archives, executable/script files, HTML, SVG, WebP, animated images and PDF are rejected. The only prior functional upload picker specified PNG/JPG, so the minimum allowlist preserves that workflow. Generated invoice PDF downloads are unchanged: generation is not an upload. Add document formats only with a separate content parser and explicit reviewed policy.

`backend/cacu/uploads/policy.json` is shared by Python validation and Next.js hints/size bounds. The SQL migration separately enforces the same roles, purpose budgets and canonical MIME/extension values as defense in depth. Changes to these rules require updating and testing the SQL boundary too.

Next.js `/api/files` POST accepts a bounded binary body, `purpose` and UUID `resource_id` query parameters, Content-Type and an URI-encoded `X-Upload-Filename`. It authenticates cookies, requires a same-origin mutation, and forwards the verified session token to Python. Next GET lists approved metadata through user RLS. `/api/files/[fileId]` provides authorized download, preview and deletion; no arbitrary storage path or signed URL is accepted. The server-only StorageService delegates to the same Python validator.

Python `/api/v1/businesses/{business_id}/files` POST accepts the same binary protocol with a Supabase Bearer session. GET/DELETE `/{file_id}` use business/file UUIDs. Upload authentication uses Supabase Auth getUser; authorization always uses current database membership, never user metadata. Resource and role checks run inside quota/promotion RPCs. Downloads recheck user RLS after fetching the object.

Pillow 12.3.0 parses signatures and content in a disposable process. Filename extension, supplied MIME, signature and parsed image format must agree. PNG CRC/chunk bounds, final markers, trailing payloads, JPEG truncation, frame count, dimensions, pixel count and compressed text limits are checked. Recognizable active metadata payloads are rejected; fresh pixel-only images remove ordinary text, EXIF, ICC and other metadata. Two concurrent parser processes per API process, a 10-second wall timeout, Linux 6-second CPU and 384 MiB address-space limits bound work. Windows uses hidden workers, time/pixel/input/metadata limits; Linux address-space/CPU controls are not claimed on Windows. This is content validation and safe serving, not a claim of universal malware detection.

Reservation locks serialize a business quota: 50 MiB stored/reserved bytes, 100 active/reserved files, 10 pending files and 30 reservations per 10 minutes. Pending rows reserve the purpose maximum until promotion. Quota/rate rejection and parser-busy errors return 429; permission errors return 401/403, invalid content 422, size failures 413 and unavailable configuration/provider 503. No provider messages, uploaded contents, credentials or signed URLs enter error responses or event logs.

## Storage and headers

New files go to private `cacu-quarantine` and are available only after validation/promotion into private `cacu-approved`. Server UUID paths contain verified business, purpose and resource IDs, never the original filename. Sanitized original filenames are metadata only. All writes disable upserts. Pending canonical paths are persisted before writing approved objects so crash cleanup can locate them.

A restrictive Storage policy blocks anon/authenticated SELECT/INSERT/UPDATE/DELETE for the new buckets and all three discovered legacy buckets, even if older broad permissive policies exist. The service-role Storage credential is used only on the Python server after authorization; it never reaches the browser or Next.js client components. No browser-to-Storage signing or direct uploads are enabled. A future direct upload flow must use private quarantine and the same authoritative validation/promotion checks.

Downloads verify size and SHA-256 and reconstruct `Content-Type`, attachment disposition, `X-Content-Type-Options: nosniff`, private/no-store, same-origin resource policy, no-referrer and a restrictive sandbox CSP. Only regenerated PNG/JPEG can use explicit inline preview. Private logos use unoptimized authenticated image requests to avoid Next image-optimizer caching/auth forwarding. Raw object, signed and arbitrary external logo URLs are not rendered.

Actual Python response headers were exercised through FastAPI TestClient; actual Next route handlers were exercised with a mocked backend in Jest. Supabase signed URL response headers were not fetched or certified; the implementation deliberately does not issue signed URLs, and uses the authorized proxy to enforce headers. Previously issued signed links may remain usable until expiration even after RLS changes; inventory them securely during rollout without copying them into logs. Revoke access sooner only through an explicitly reviewed legacy relocation/revalidation plan, never by deleting historical objects automatically.

## Setup and rollout

1. Review `supabase/migrations/20261011030324_secure_file_uploads.sql` on a disposable/staging project with the existing business, membership, invoice, transaction and Storage schemas. No accounting cutover is required for uploads. Check migration history before deployment. This CLI-generated timestamp precedes this branch's accounting migrations; an existing deployment with later versions needs the backfill flag. Review the complete plan first:
   ```sh
   supabase db push --dry-run --include-all
   ```
   The migration changes Storage access for legacy buckets; deploy the new API/UI and revalidation plan together. Apply only reviewed migrations to the intended project. No live migration was applied during implementation.
2. Install Python 3.12 backend dependencies from `requirements.lock` or the checked `uv.lock`. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and **Python-only** `CACU_STORAGE_SERVICE_ROLE_KEY` to a securely provisioned legacy service-role JWT. Never use `NEXT_PUBLIC_` for that credential. The accounting database DSN remains the restricted `cacu_runtime` login; no SQL privileges are added to that role for uploads. The app does not automatically read .env files.
3. Set Next `CACU_UPLOAD_API_URL` to the HTTPS Python backend, or leave it unset to use `CACU_ACCOUNTING_API_URL`. Next uses server session tokens, not a Storage service-role credential. Configure ordinary existing Supabase public URL/key and cookies.
4. Schedule `python -m tools.cleanup_uploads --apply` from backend with server-only Storage credentials at least hourly. Without `--apply` it changes nothing. It claims up to 100 expired pending/deleting/cleanup-required rows, plus approved newly managed files whose resource was deleted, removes objects through Storage's API and records cleanup status. A one-hour grace prevents racing a bounded active request. Failures retain their quota reservation and retry next run. Do not SQL-delete storage.objects: use Storage APIs for bytes and metadata together.
5. Verify a fresh permitted image, role-restricted failure, cross-business denial, quota failure, download/preview headers and cleanup on staging. Vercel preview access and production secrets remain external setup requirements; no deployed Supabase-authenticated browser flow has been verified here.

## Legacy inventory and revalidation

Read-only live inspection on 11 October 2026 found:

| Bucket | Public | Objects |
| --- | --- | --- |
| business-assets | false | 1 |
| business-logos | true | 0 |
| business-documents | false | 0 |

Legacy object `f63acaa8-0e24-4ca1-91d7-5bf9b90a021e` in business-assets declares image/png and 13,995 bytes; its old object name has no extension. These are untrusted metadata, not a content validation result. Revalidation must derive a safe .png/.jpg display name from signature and parser agreement, not that MIME declaration. One businesses.logo_url reference exists. Existing business-logos policies allow public reads; business-documents policies allow raw member reads/editor writes. All are covered by the restrictive migration. The existing object and logo reference require revalidation; they were not downloaded, modified or deleted. Inventory privileged object IDs/paths and ownership securely, then read each object with a trusted operator, run the same validator, upload it using the new authenticated purpose/resource flow and replace its reference with the controlled preview route. Keep original objects until retention/review explicitly authorizes their disposal. Old unsigned/signed logo references show the application brand fallback until revalidation. Future inventories should use counts and metadata only in ordinary logs.

## Verification

- Full Python suite: 79 passed before the final compensation test; final focused upload suite: 40 passed, including 30 upload/parser/endpoint/transport tests and 10 real PostgreSQL upload migration/policy tests, plus existing accounting checks. PostgreSQL tests use only a disposable localhost database ending `_test`; never a production DSN.
- Jest: 24 passed, including seven new Next proxy/policy checks.
- Chromium component suite: five passed, including attachment picker validation and approved-route links. Business context and network/server actions are explicit test doubles; this is not deployed end-to-end verification.
- TypeScript passed. Targeted ESLint returned zero errors with existing style warnings. Production Next build returned actual exit code zero; existing OpenTelemetry/style warnings remain.
- Pinned backend dependency audit: no known vulnerabilities. `uv lock --check` passed. Tests cover permitted files, spoofed MIME/extension, MZ executables, malformed/CRC/signature failures, trailing payloads, animated images, oversized bodies, decompression abuse, traversal, duplicate names, unauthorized direct writes/overwrite/deletion, auth and tenant denial, concurrent/byte quotas, promotion reauthorization, quarantine failure cleanup, crash paths, deleted-resource orphans, integrity mismatch and download/preview headers.

Native Python-accounting Linux dependencies and preview access have the existing deployment gates; successful local parsing and Next build do not prove a deployed Python environment. Storage configuration/secrets, the staging migration and the scheduled cleanup job must be provisioned before enabling production uploads.
