import { FeatureUnavailable } from '@/components/feature-unavailable';

/** R0 honest state: Docs 05 TD-010, 12 SCR-19, 19 TEST-407. */
export default function Page() {
  return <FeatureUnavailable
    title="Chart of Accounts"
    description="The chart of accounts is not available yet. Accounts added here were never saved; it will show your real accounts when your books are set up."
  />;
}
