# R0 honest screens, brand colour and security headers - implementation review

## Scope

Doc 05 TD-008/TD-010/TD-014, Doc 12 SCR-15/16/19/24 and DEC-005, Doc 16 SEC-022/SEC-031, Doc 19 TEST-406/TEST-407. The owner chose to mark appointments, jobs and the chart of accounts unavailable for now rather than wire them to their tables (Phase 3, M-13 and R1 chart endpoints).

## Change

- **Unavailable screens.** `/appointments`, `/jobs` and `/accounting/chart-of-accounts` kept records only in browser state seeded from `src/lib/data` and saved nothing; `/settings/profile` showed sample details ("Jane Doe") and a "saved successfully" toast with no persistence. All four now use `FeatureUnavailable`, like the nine screens in the earlier R0 change. The mode guards in the appointments and jobs layouts are unchanged.
- **Home.** The revenue tile no longer shows a fixed "up" trend arrow. Load failures already show an error with Retry, never zero.
- **Brand colour.** `--primary`, `--ring`, `--chart-1` and the sidebar accent tokens move from `hsl(250 100% 60%)` (#5233FF) to `hsl(248.8 100% 62.5%)` (#5C40FF) in light and dark themes.
- **Image hosts.** `placehold.co` and `picsum.photos` are removed from `next.config.ts`; the sidebar avatar falls back to initials instead of a placeholder image. The hidden community prototype still references `picsum` images but never renders behind its unavailable layout.
- **Headers.** `next.config.ts` adds a Content-Security-Policy and Permissions-Policy to every route (`src/lib/security-headers.ts`). The policy allows only this app and the Supabase project named in `NEXT_PUBLIC_SUPABASE_URL` (Auth and Realtime), so staging and production each allow only their own project. `vercel.json` keeps its existing headers.

## Known limits

- Scripts and styles still allow `'unsafe-inline'`, which Next.js needs without nonces. Nonce-based CSP is SEC-022 for R1 and requires dynamic rendering.
- `xlsx` is no longer imported anywhere in `src`; removing the dependency needs a separate approval.
- The Vercel preview toolbar (`vercel.live`) is not allowed by the policy, so comments on preview deployments will not load.

## Verification

- Jest 267 passed in 35 suites (adds `security-headers.test.ts` and four honest-state cases). Playwright components 39 passed. TypeScript, ESLint on changed files and `next build` passed.
- `next start` locally: `/login` returns both headers with the project origin; headless Chromium loaded `/login` and `/signup` with no console errors or CSP violations.

## Release steps

After deploy, open sign-in, the dashboard, notifications (Realtime) and a business logo upload in production and check the browser console for "Refused to" messages. If one appears, roll back the deployment and add the blocked origin in a follow-up change.
