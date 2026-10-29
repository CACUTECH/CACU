import { FeatureUnavailable } from '@/components/feature-unavailable';

/** R0 honest state: Docs 05 TD-008/009, 12 SCR-18/20/24, 19 TEST-407. */
export default function Page() {
  return <FeatureUnavailable
    title="Language & Currency"
    description="Language and reporting currency preferences are not available yet. No regional preferences can be changed or saved here."
  />;
}
