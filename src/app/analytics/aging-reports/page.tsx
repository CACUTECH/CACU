import { FeatureUnavailable } from '@/components/feature-unavailable';

/** R0 honest state: Docs 05 TD-008/009, 12 SCR-18/20/24, 19 TEST-407. */
export default function Page() {
  return <FeatureUnavailable
    title="Receivables & Payables Aging"
    description="Ageing reports are not available yet. Verified invoice, bill and payment allocations must be connected before outstanding balances can be shown."
  />;
}
