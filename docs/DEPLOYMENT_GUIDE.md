# CACU Deployment Guide (Vercel & Supabase)

This document outlines the high-integrity workflow for deploying CACU to production.

## 1. Git Workflow
All changes must follow this lifecycle to maintain financial and security integrity:

1.  **Feature Branch**: Create a branch `feat/your-feature`.
2.  **Pull Request**: Open a PR to `main`.
3.  **CI Validation**: GitHub Actions will automatically run:
    *   `npm run lint` (Code Quality)
    *   `npm run typecheck` (Type Safety)
    *   `npm run test` (Security & Financial Integrity Suite)
    *   `npm run build` (Production Build Verification)
4.  **Preview Deployment**: Vercel generates a preview URL for QA.
5.  **Merge & Deploy**: Merging to `main` triggers the production deployment.

## 2. Environment Variables & Secrets
Secrets are managed in the Vercel and Supabase dashboards. **Never commit secrets to Git.**

| Variable | Dev / Preview (Staging) | Production |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | Staging Project URL | Production Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Staging Anon Key | Production Anon Key |
| `SUPABASE_SERVICE_ROLE_KEY` | Staging Service Role | Production Service Role |
| `GEMINI_API_KEY` | Sandbox Key | Production Key |

## 3. Database Migration Safety
Production database schema changes must be managed via Supabase CLI migrations:

1.  Create migration: `npx supabase migration new your_change`
2.  Test locally: `npx supabase db reset`
3.  Apply to Production: Use the Supabase dashboard "SQL Editor" or linked GitHub migration workflow.

**Warning**: Never run `db reset` or destructive SQL against the production instance.

## 4. Post-Deployment Verification
After every production deploy, verify:
1.  **Login**: Ensure sessions persist correctly.
2.  **Ledger**: Post a test ₦1 transaction and verify the Audit Log.
3.  **Storage**: Upload a test logo and verify the RLS isolation.
4.  **AI**: Run an onboarding document generation test.
