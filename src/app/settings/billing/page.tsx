
"use client";

import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Sparkles, CreditCard, Banknote, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSubscription } from "@/components/subscription-guard";
import { cn } from "@/lib/utils";

const plans = [
    {
        id: 'Starter',
        name: 'Starter',
        price: 'Free',
        desc: 'For solo entrepreneurs in Nigeria.',
        features: ['Basic POS', 'Catalog/Inventory', 'Single User', 'Manual Receipts']
    },
    {
        id: 'Growth',
        name: 'Growth',
        price: '₦15,000/mo',
        desc: 'For small shops and consulting firms.',
        features: ['Full Accounting Suite', 'Basic HR & Payroll', 'Up to 5 Users', 'WhatsApp Storefront', 'Bank Reconciliations']
    },
    {
        id: 'Enterprise',
        name: 'Enterprise',
        price: '₦45,000/mo',
        desc: 'Full automation for growing MSMEs.',
        features: ['AI HR Assistant', 'Onboarding/Termination Automation', 'Advanced Workforce Analytics', 'Unlimited Users', 'API Access', 'Custom Domain']
    }
];

export default function BillingPage() {
    const { toast } = useToast();
    const { tier } = useSubscription();

    const handleUpgrade = (planId: string) => {
        if (planId === tier) return;
        
        toast({
            title: "Redirecting to Paystack",
            description: `Preparing your subscription for the ${planId} plan.`,
        });

        // Simulate payment completion
        setTimeout(() => {
            localStorage.setItem('subscription-tier', planId);
            toast({
                title: "Upgrade Successful!",
                description: `Your business is now on the ${planId} tier. Refreshing modules...`,
            });
            setTimeout(() => window.location.reload(), 1500);
        }, 2000);
    };

    return (
        <div className="flex flex-col gap-8 pb-12">
            <div>
                <h1 className="font-headline text-3xl font-bold">Subscription & Payouts</h1>
                <p className="text-muted-foreground mt-1">Manage your plan and configure settlement accounts for your digital store.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {plans.map((plan) => (
                    <Card key={plan.id} className={cn(
                        "flex flex-col relative",
                        plan.id === tier ? "border-primary ring-2 ring-primary/20 bg-primary/5" : "border-border"
                    )}>
                        {plan.id === 'Growth' && (
                            <div className="absolute top-0 right-0 p-3">
                                <Badge className="bg-amber-500 hover:bg-amber-600">Most Popular</Badge>
                            </div>
                        )}
                        {plan.id === tier && (
                            <div className="absolute top-0 right-0 p-3">
                                <Badge className="bg-emerald-500 flex items-center gap-1">
                                    <CheckCircle2 className="h-3 w-3" /> Current Plan
                                </Badge>
                            </div>
                        )}
                        <CardHeader>
                            <CardTitle className="text-2xl font-headline">{plan.name}</CardTitle>
                            <div className="mt-2 flex items-baseline gap-1">
                                <span className="text-4xl font-bold">{plan.price}</span>
                                {plan.price !== 'Free' && <span className="text-muted-foreground text-sm">/month</span>}
                            </div>
                            <CardDescription className="mt-4">{plan.desc}</CardDescription>
                        </CardHeader>
                        <CardContent className="flex-grow">
                            <ul className="space-y-3">
                                {plan.features.map((feature, i) => (
                                    <li key={i} className="flex items-start gap-2 text-sm">
                                        <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                                        <span>{feature}</span>
                                    </li>
                                ))}
                            </ul>
                        </CardContent>
                        <CardFooter>
                            <Button 
                                className="w-full h-12 rounded-xl text-lg font-bold" 
                                variant={plan.id === tier ? "outline" : "default"}
                                onClick={() => handleUpgrade(plan.id)}
                            >
                                {plan.id === tier ? "Current Plan" : `Switch to ${plan.name}`}
                            </Button>
                        </CardFooter>
                    </Card>
                ))}
            </div>

            <Card className="bg-muted/30 border-dashed border-2">
                <CardHeader>
                    <div className="flex items-center gap-3">
                        <div className="bg-white p-3 rounded-xl shadow-sm border">
                            <Banknote className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                            <CardTitle>Payout Settlements</CardTitle>
                            <CardDescription>Where we send your online store earnings.</CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="space-y-1">
                        <p className="font-bold">Sterling Bank (...5678)</p>
                        <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest">Active Beneficiary: CACU Technologies Ltd</p>
                    </div>
                    <div className="flex items-center gap-2 text-emerald-600 font-bold text-xs uppercase tracking-widest bg-emerald-500/10 px-3 py-1.5 rounded-full border border-emerald-500/20">
                        <ShieldCheck className="h-4 w-4" /> Verified for Transfers
                    </div>
                    <Button variant="outline" size="sm">Change Bank Account</Button>
                </CardContent>
            </Card>
        </div>
    );
}
