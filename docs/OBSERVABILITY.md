# CACU Production Observability Guide

This document outlines the investigation procedures for common production issues using our structured logging and monitoring suite.

## Log Search & Investigation

All logs are output as structured JSON. When using a log management tool (e.g., Datadog, Axiom, or Vercel Logs), use the following filters:

### 1. Failed Login Investigation
- **Filter**: `level:SECURITY AND service:Auth`
- **Steps**:
    1. Search for the user's email.
    2. Check the `context.authError` field for specific Supabase error codes (e.g., `invalid_credentials`).
    3. Look for multiple security logs from the same IP to identify brute-force attempts.

### 2. Failed POS Sale / Transaction
- **Filter**: `level:ERROR AND service:SalesService`
- **Steps**:
    1. Filter by `businessId`.
    2. Inspect the `error` object. Common issues: `Insufficient stock` or `Database constraint violation`.
    3. Cross-reference the `requestId` in `sales` and `financial_transactions` tables.

### 3. Slow Dashboard / API Performance
- **Filter**: `level:PERF`
- **Steps**:
    1. Look for `duration > 500`. 
    2. Identify the `service` and specific operation (e.g., `get_business_kpis`).
    3. If duration is high, investigate database query plans for missing indexes on `created_at` or `business_id`.

### 4. Storage Failures
- **Filter**: `level:ERROR AND service:StorageService`
- **Steps**:
    1. Check `context.sanitizedPath`.
    2. Verify if the error is `File exceeds 5MB limit` or an RLS permission denied error.

## Monitoring Thresholds
- **Critical Alert**: `level:ERROR` frequency > 50 per hour.
- **Security Alert**: `level:SECURITY` frequency > 10 per minute from a single IP.
- **Latency Alert**: `level:PERF` average duration > 1000ms.

## Redaction Policy
Our `Logger` class automatically redacts fields containing:
- `password`
- `token`
- `secret`
- `key`
- `accountNumber`

*Never log raw JWTs or transaction payloads containing customer PII in clear text.*
