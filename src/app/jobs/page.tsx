import { FeatureUnavailable } from '@/components/feature-unavailable';

/** R0 honest state: Docs 05 TD-010, 12 SCR-16, 19 TEST-407. */
export default function Page() {
  return <FeatureUnavailable
    title="Work Orders & Jobs"
    description="Jobs are not available yet. This screen kept jobs only in your browser, so they were never saved to your business."
  />;
}
