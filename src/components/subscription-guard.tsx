
"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Lock, Sparkles, ArrowRight } from 'lucide-react';
import Link from 'next/link';

type SubscriptionTier = 'Starter' | 'Growth' | 'Enterprise';

interface SubscriptionContextType {
    tier: SubscriptionTier;
    isFeatureAccessible: (requiredTier: SubscriptionTier) => boolean;
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
    const [tier, setTier] = useState<SubscriptionTier>('Starter');

    useEffect(() => {
        const savedTier = localStorage.getItem('subscription-tier') as SubscriptionTier;
        if (savedTier) setTier(savedTier);
    }, []);

    const isFeatureAccessible = (requiredTier: SubscriptionTier) => {
        const tiers: SubscriptionTier[] = ['Starter', 'Growth', 'Enterprise'];
        return tiers.indexOf(tier) >= tiers.indexOf(requiredTier);
    };

    return (
        <SubscriptionContext.Provider value={{ tier, isFeatureAccessible }}>
            {children}
        </SubscriptionContext.Provider>
    );
}

export function useSubscription() {
    const context = useContext(SubscriptionContext);
    if (context === undefined) {
        throw new Error('useSubscription must be used within a SubscriptionProvider');
    }
    return context;
}

export function FeatureGate({ 
    requiredTier, 
    children, 
    fallbackTitle,
    fallbackDesc 
}: { 
    requiredTier: SubscriptionTier, 
    children: React.ReactNode,
    fallbackTitle?: string,
    fallbackDesc?: string
}) {
    const { isFeatureAccessible } = useSubscription();

    if (isFeatureAccessible(requiredTier)) {
        return <>{children}</>;
    }

    return (
        <Card className="border-primary/20 bg-primary/5 shadow-none border-dashed overflow-hidden relative">
            <div className="absolute top-0 right-0 p-3">
                <div className="bg-primary/10 text-primary text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-tighter flex items-center gap-1">
                    <Sparkles className="h-3 w-3" /> {requiredTier} Feature
                </div>
            </div>
            <CardHeader className="text-center pt-8">
                <div className="bg-primary/10 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Lock className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-xl">{fallbackTitle || "Upgrade Required"}</CardTitle>
                <CardDescription className="max-w-xs mx-auto">
                    {fallbackDesc || `Access to this module requires the ${requiredTier} plan or higher.`}
                </CardDescription>
            </CardHeader>
            <CardFooter className="justify-center pb-8">
                <Button asChild size="sm">
                    <Link href="/settings/billing">
                        Upgrade Now <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                </Button>
            </CardFooter>
        </Card>
    );
}
