import { FeatureUnavailable } from '@/components/feature-unavailable';

/** R0 honest state: Docs 05 TD-008, 12 SCR-24, 19 TEST-407. The previous form showed sample details and a save that did not persist. */
export default function Page() {
  return <FeatureUnavailable
    title="Personal Profile"
    description="Editing your profile is not available yet. Your name and email come from your sign-in account."
  />;
}
