# CACU Production Deployment Checklist

### 1. Staging Verification (MANDATORY)
- [ ] **Smoke Test**: All green on `/admin/staging`.
- [ ] **Auth**: New user registration and Google OAuth verified.
- [ ] **Ledger**: Record a ₦1 transaction and verify no RLS leakage.
- [ ] **Inventory**: Atomic stock decrement tested via POS.
- [ ] **Storage**: File upload/download (Logo/Receipts) working with Signed URLs.

### 2. Database & Security
- [x] **Supabase RLS**: All tables have `tenant_isolation` policies enabled.
- [x] **Hardened RPCs**: Financial functions verify membership internally.
- [x] **Audit Logging**: `record_audit` is active for manual ledger entries.
- [x] **Encryption**: All connections forced to HTTPS.

### 3. Infrastructure (Vercel)
- [x] **CI/CD**: GitHub Actions blocking PRs on test failure.
- [x] **Security Headers**: HSTS, CSP, and XFO configured in `vercel.json`.
- [x] **Secrets**: Env variables separated between Staging and Production.

### 4. Application Health
- [x] **Observability**: `StructuredLogger` active in production environment.
- [x] **Error Handling**: Global `ErrorBoundary` configured with log ingestion.
- [x] **Performance**: B-Tree and GIN indexes applied to high-traffic columns.

### 5. Compliance (Nigeria)
- [x] **FIRS/LIRS**: PAYE tax tables verified for 2024 standards.
- [x] **Data Privacy**: Redaction policy active for PII in logs.
