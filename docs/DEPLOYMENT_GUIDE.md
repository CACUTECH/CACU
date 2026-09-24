# CACU Deployment Guide (Vercel & Supabase)

This document outlines the high-integrity workflow for deploying CACU to staging and production.

## 1. Environment Strategy

We maintain three strictly isolated environments:

| Environment | Purpose | Vercel Scope | Supabase Project |
| :--- | :--- | :--- | :--- |
| **Development** | Local coding | `development` | Local / Dev Project |
| **Staging** | QA & Regression | `preview` (branch: `staging`) | Staging Project |
| **Production** | Live Users | `production` | Production Project |

## 2. Git Workflow (Promote-to-Prod)

1.  **Feature**: Create `feat/your-feature` -> PR to `main`.
2.  **Verify**: GitHub Actions run lint/typecheck/tests.
3.  **Staging**: Merge to `staging` branch. Vercel deploys to Staging URL.
4.  **QA**: Run Staging Smoke Tests at `/admin/staging`.
5.  **Release**: PR from `staging` to `main`.
6.  **Production**: Merging to `main` triggers production deploy.

## 3. Environment Variables & Secrets

**NEVER share keys between Staging and Production.**

| Variable | Staging (Preview) | Production |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://staging-xyz.supabase.co` | `https://prod-abc.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Staging Anon Key | Production Anon Key |
| `SUPABASE_SERVICE_ROLE_KEY` | Staging Service Role | Production Service Role |
| `GEMINI_API_KEY` | Sandbox Key | Production Key |

## 4. Staging Data Policy

*   **Anonymization**: If production data is required for testing, use a script to redact `email`, `phone`, and `bank_account` fields before importing to Staging.
*   **Wiping**: Staging database can be reset (`db reset`) during major version upgrades.

## 5. Post-Deployment (Staging)
Verify all systems via the **Staging Command Center**: `https://staging.cacu.app/admin/staging`
