"use client";

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { FeatureUnavailable } from '@/components/feature-unavailable';

type SubscriptionTier = 'Starter' | 'Growth' | 'Enterprise';
interface SubscriptionContextType {
  tier: SubscriptionTier | null;
  isFeatureAccessible: (requiredTier: SubscriptionTier) => boolean;
}
// Presentation only. Paid access remains unavailable until an authoritative
// tenant subscription policy and verified billing are implemented.
const snapshot: SubscriptionContextType = {
  tier: null,
  isFeatureAccessible: requiredTier => requiredTier === 'Starter',
};
const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);
export function SubscriptionProvider({ children }: { children: ReactNode }) {
  return <SubscriptionContext.Provider value={snapshot}>{children}</SubscriptionContext.Provider>;
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
    description={fallbackDesc ?? 'Paid features are not available until billing and access checks are ready.'} />;
}
