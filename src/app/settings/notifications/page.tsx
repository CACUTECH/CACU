import { FeatureUnavailable } from '@/components/feature-unavailable';

/** R0 honest state: Docs 05 TD-008/009, 12 SCR-18/20/24, 19 TEST-407. */
export default function Page() {
  return <FeatureUnavailable
    title="Notification Preferences"
    description="Notification delivery preferences are not available yet. Email, SMS and WhatsApp alerts cannot be enabled or changed here."
  />;
}
