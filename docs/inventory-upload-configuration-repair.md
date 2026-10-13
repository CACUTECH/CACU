# Inventory upload configuration repair

Read-only production inspection on 13 October 2026 confirmed the cause of `Secure uploads are not configured`: the Vercel `cacu` project has neither `CACU_UPLOAD_API_URL` nor its accounting fallback, and the `backend` project has no environment variables. A local `.env` alone does not configure deployed Vercel services.

The existing backend production alias responds successfully at `/health`. The deployed Supabase project matches the ignored local `.env`; its existing server credential successfully reads upload metadata and Storage bucket metadata. `upload_records` is present, and `cacu-quarantine` and `cacu-approved` are both private. No migration, permission relaxation or bucket visibility change is needed for this repair.

## Proposed changes requiring production approval

Within Vercel team `olayiwolaas-projects` only, add these currently absent variables to **Production**:

| Project | Variable | Value source |
| --- | --- | --- |
| cacu | CACU_UPLOAD_API_URL | https://backend-one-mocha-12.vercel.app |
| backend | SUPABASE_URL | Existing deployed cacu NEXT_PUBLIC_SUPABASE_URL |
| backend | SUPABASE_PUBLISHABLE_KEY | Existing deployed cacu NEXT_PUBLIC_SUPABASE_ANON_KEY |
| backend | CACU_STORAGE_SERVICE_ROLE_KEY | Existing matching SUPABASE_SERVICE_ROLE_KEY from ignored local .env; store as Sensitive |

Never prefix the storage credential with NEXT_PUBLIC_, put it in browser code or include it in logs. Existing variables and accounting configuration must remain untouched. This does not configure or enable native accounting, email delivery, AI or commercial rules. Preview environments remain unchanged.

Redeploy the existing backend production deployment first, then the existing frontend production deployment. Both inspected deployments use commit `9cf7dcb6dd41f1470226a254f6ea6b6d8befdd34`; inspect again before proceeding and preserve any newer user changes. Environment-variable updates take effect only on new deployments. No merge or code change is required.

Verify backend health and unauthenticated upload denial, then verify a permitted inventory image and its authorized preview through the signed-in application. Do not create business records or live test uploads without the user's authorization. Keep existing file validation, authorization, quotas and private storage controls intact.

## Rollback and status

If the repair fails, restore the previous deployments and remove only variables added by this repair. Existing deployments retain their environment snapshot. No database or Storage rollback is required because no records, policies or buckets are changed.

The user explicitly approved the repair. All four Production variables were added, and backend deployment `dpl_4kiUmNARmXmhwvqVuQdEDtjXY28b` and frontend deployment `dpl_27DGxUvbpDhDZxF5huxZKrbj5hy6` completed with Ready status using the existing reviewed commit. The frontend is active at https://www.usecacu.com and the backend at https://backend-one-mocha-12.vercel.app.

Live checks: backend health HTTP 200; missing and invalid sessions HTTP 401; frontend Vercel alias login HTTP 200 and unauthenticated file access remains protected. The four Production settings were rechecked by name and scope without exposing values. Existing local checks passed: 30 Python upload tests, six Next upload security tests and one browser attachment test. The custom domain www.usecacu.com returned a TLS hostname mismatch during verification; use the verified Vercel alias https://cacu-sigma.vercel.app until its domain certificate is corrected. A signed-in inventory image upload has not been performed; no business records, files, buckets or policies were changed by verification.
