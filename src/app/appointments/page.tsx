import { FeatureUnavailable } from '@/components/feature-unavailable';

/** R0 honest state: Docs 05 TD-010, 12 SCR-15, 19 TEST-407. */
export default function Page() {
  return <FeatureUnavailable
    title="Appointments"
    description="Bookings are not available yet. This calendar kept bookings only in your browser, so they were never saved to your business."
  />;
}
