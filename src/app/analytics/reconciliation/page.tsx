import { FeatureUnavailable } from '@/components/feature-unavailable';

/** R0 honest state: Docs 05 TD-008/009, 12 SCR-18/20/24, 19 TEST-407. */
export default function Page() {
  return <FeatureUnavailable
    title="Bank Reconciliation"
    description="Bank reconciliation is not available yet. Statement import and matching cannot be saved here; no transactions have been reconciled from this screen."
  />;
}
