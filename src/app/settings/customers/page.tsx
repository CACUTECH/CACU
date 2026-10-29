import { FeatureUnavailable } from '@/components/feature-unavailable';

/** R0 honest state: Docs 05 TD-008/009, 12 SCR-18/20/24, 19 TEST-407. */
export default function Page() {
  return <FeatureUnavailable
    title="Customer Loyalty"
    description="Customer loyalty points and rewards are not available yet. No earning or redemption rules can be saved here."
  />;
}
