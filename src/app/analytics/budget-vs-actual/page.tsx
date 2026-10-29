import { FeatureUnavailable } from '@/components/feature-unavailable';

/** R0 honest state: Docs 05 TD-008/009, 12 SCR-18/20/24, 19 TEST-407. */
export default function Page() {
  return <FeatureUnavailable
    title="Budget vs. Actual"
    description="Budget comparisons are not available yet. Saved budgets and verified spending must be connected before comparisons can be shown."
  />;
}
