import { FeatureUnavailable } from '@/components/feature-unavailable';
export default function Page() {
  return <FeatureUnavailable title="Offline access" description="CACU currently needs an internet connection to save business records. Offline drafts and synchronization are not available yet. Keep your connection active until a save is confirmed." />;
}
