"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { FeatureUnavailable } from '@/components/feature-unavailable';
import { useOptionalBusiness } from '@/components/business-provider';
import { getCurrentPlanAction } from '@/app/settings/billing/actions';
import type { CurrentPlan } from '@/lib/billing';

// Plan codes from platform.plans: General (BASE), Oga (GROW), Chairman (TOP).
type SubscriptionTier = 'BASE' | 'GROW' | 'TOP';
const RANK: Record<SubscriptionTier, number> = { BASE: 1, GROW: 2, TOP: 3 };
interface SubscriptionContextType {
  tier: SubscriptionTier | null;
  plan: CurrentPlan | null;
  isFeatureAccessible: (requiredTier: SubscriptionTier) => boolean;
  refresh: () => Promise<void>;
}
const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

/** The active business's plan, read from the database on each business change and after leaving the billing page.
 * Only the server's answer grants a tier: nothing stored in the browser does. A read-only (suspended) business has
 * no paid tier. Presentation only; the database enforces every limit itself. */
export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const businessId = useOptionalBusiness()?.business?.id ?? null;
  const pathname = usePathname();
  const [plan, setPlan] = useState<CurrentPlan | null>(null);
  const previousPath = useRef(pathname);
  const refresh = useCallback(async () => {
    if (!businessId) { setPlan(null); return; }
    const result = await getCurrentPlanAction();
    setPlan(result.success ? result.data : null);
  }, [businessId]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    // A payment or plan change happens on the billing page; pick it up on the way out.
    if (previousPath.current === '/settings/billing' && pathname !== '/settings/billing') void refresh();
    previousPath.current = pathname;
  }, [pathname, refresh]);
  const tier = plan?.subscribed && plan.writes_allowed ? plan.plan : null;
  const value: SubscriptionContextType = {
    tier, plan, refresh,
    isFeatureAccessible: requiredTier => tier ? RANK[tier] >= RANK[requiredTier] : requiredTier === 'BASE',
  };
  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}
export function useSubscription() {
  const context = useContext(SubscriptionContext);
  if (!context) throw new Error('useSubscription must be used within a SubscriptionProvider');
  return context;
}
export function FeatureGate({ requiredTier, children, fallbackTitle, fallbackDesc }: {
  requiredTier: SubscriptionTier; children: ReactNode; fallbackTitle?: string; fallbackDesc?: string;
}) {
  const { isFeatureAccessible } = useSubscription();
  return isFeatureAccessible(requiredTier) ? <>{children}</> : <FeatureUnavailable
    title={fallbackTitle ?? 'Feature unavailable'}
    description={fallbackDesc ?? 'This feature is on a higher plan. Upgrade in Billing to use it.'} />;
}
