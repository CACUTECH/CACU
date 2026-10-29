import { FeatureUnavailable } from '@/components/feature-unavailable';

/** R0 honest state: Docs 05 TD-008/009, 12 SCR-18/20/24, 19 TEST-407. */
export default function Page() {
  return <FeatureUnavailable
    title="Tax Settings"
    description="Tax configuration is not available yet. Changes to tax rates and automatic VAT calculations cannot be saved here."
  />;
}
