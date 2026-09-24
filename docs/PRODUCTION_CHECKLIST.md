# CACU Production Deployment Checklist

### 1. Database & Security
- [x] **Supabase RLS**: All tables have `tenant_isolation` policies enabled.
- [x] **Hardened RPCs**: Financial functions verify membership internally.
- [x] **Audit Logging**: `record_audit` is active for manual ledger entries.
- [x] **Encryption**: All connections forced to HTTPS.

### 2. Infrastructure (Vercel)
- [x] **CI/CD**: GitHub Actions blocking PRs on test failure.
- [x] **Security Headers**: HSTS, CSP, and XFO configured in `vercel.json`.
- [x] **Secrets**: Env variables separated between Preview and Production.

### 3. Application Health
- [x] **Observability**: `StructuredLogger` active in production environment.
- [x] **Error Handling**: Global `ErrorBoundary` configured with log ingestion.
- [x] **Performance**: B-Tree and GIN indexes applied to high-traffic columns.

### 4. Compliance (Nigeria)
- [x] **FIRS/LIRS**: PAYE tax tables verified for 2024 standards.
- [x] **Data Privacy**: Redaction policy active for PII in logs.

### 5. AI (Genkit)
- [x] **Quota**: Monitoring API usage for Enterprise-tier document generation.
- [x] **Prompt Safety**: Handlebars templates sanitized for injection prevention.
