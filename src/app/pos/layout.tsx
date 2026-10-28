import type { ReactNode } from 'react';
import { BusinessModeGuard } from '@/components/business-mode-guard';
export default function Layout({ children }: { children: ReactNode }) {
  return <BusinessModeGuard path="/pos">{children}</BusinessModeGuard>;
}
