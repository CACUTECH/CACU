import type { ReactNode } from 'react';
import { getBusinessSelectionAction } from '@/app/business-actions';

export default async function HRLayout({ children }: { children: ReactNode }) {
  let allowed = false;
  try {
    const { active } = await getBusinessSelectionAction();
    allowed = active?.role === 'owner' || active?.role === 'admin';
  } catch { /* Fail closed when membership cannot be verified. */ }
  if (!allowed) return <div role="alert">HR access requires an active Owner or Admin membership. Select an authorized business and retry.</div>;
  return <>{children}</>;
}
