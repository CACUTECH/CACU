import type { ReactNode } from 'react';
import Link from 'next/link';
import { BusinessModeService } from '@/services/business-mode-service';
import { isRouteAvailableInMode } from '@/lib/business-mode';

export async function BusinessModeGuard({ path, children }: { path: string; children: ReactNode }) {
  try {
    const mode = await new BusinessModeService().read();
    if (isRouteAvailableInMode(path, mode)) return <>{children}</>;
    return <div className="space-y-4"><h1 className="text-2xl font-bold">Unavailable in {mode.toLowerCase()} mode</h1>
      <p>{path === '/pos' ? 'Use invoices for service sales, or select Product or Hybrid mode for POS checkout.' : 'Select Service or Hybrid mode to use appointments and work orders.'}</p>
      <Link className="text-primary underline" href="/settings/business">Business mode settings</Link></div>;
  } catch {
    return <p role="alert">Your business mode could not be verified. Refresh your session and active business selection.</p>;
  }
}
