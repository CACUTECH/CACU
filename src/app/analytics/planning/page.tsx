import { FeatureUnavailable } from '@/components/feature-unavailable';

/** R0 honest state: Docs 05 TD-008/009, 12 SCR-18/20/24, 19 TEST-407. */
export default function Page() {
  return <FeatureUnavailable
    title="Planning & Budgeting"
    description="Budget planning is not available yet. Budget items cannot be created, saved or exported here."
  />;
}
