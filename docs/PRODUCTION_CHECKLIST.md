
# CACU Production Deployment Checklist

### 1. Database & Security
- [ ] **Firestore Rules**: Deploy rules from `docs/backend.json` structure to restrict access to `request.auth.uid`.
- [ ] **Encryption**: Ensure all business-sensitive data (Bank details, Salaries) are accessed only via HTTPS.
- [ ] **Backups**: Enable Google Cloud Firestore PITR (Point-in-Time Recovery).

### 2. Authentication
- [ ] **Email Verification**: Force email verification before allowing dashboard access.
- [ ] **RBAC**: Map Firebase custom claims to application roles (Owner, Admin, Staff).

### 3. Payment Integration (Nigeria)
- [ ] **Paystack/Flutterwave**: Configure live API keys for `Standard` and `Enterprise` plan billing.
- [ ] **Webhook Handling**: Setup a Next.js API route to process `charge.success` events to update subscription status.

### 4. AI (Genkit)
- [ ] **Environment Variables**: Move `GEMINI_API_KEY` to production secret management.
- [ ] **Quota Management**: Monitor API usage to avoid disruptions for Enterprise users.

### 5. Compliance
- [ ] **FIRS/LIRS**: Verify that the PAYE tax table reflects current 2024 consolidated relief allowances.
- [ ] **CAC**: Ensure the business registration guide links to the latest official portals.
