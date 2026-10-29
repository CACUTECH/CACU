import { FeatureUnavailable } from '@/components/feature-unavailable';

/** R0 honest state: Docs 05 TD-008/009, 12 SCR-18/20/24, 19 TEST-407. */
export default function Page() {
  return <FeatureUnavailable
    title="Key Performance Indicators"
    description="This KPI dashboard is not available yet. Verified business metrics must be connected before figures can be shown."
  />;
}
