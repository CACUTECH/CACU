
"use client";

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Package, Briefcase, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BusinessType } from '@/lib/data';

export default function BusinessSettingsPage() {
    const { toast } = useToast();
    const [businessType, setBusinessType] = React.useState<BusinessType>('HYBRID');
    const [mounted, setMounted] = React.useState(false);

    React.useEffect(() => {
        setMounted(true);
        const savedType = localStorage.getItem('business-type') as BusinessType;
        if (savedType) setBusinessType(savedType);
    }, []);

    const handleSave = () => {
        localStorage.setItem('business-type', businessType);
        
        toast({
            title: "Business Profile Saved",
            description: `Configuration updated to ${businessType.toLowerCase()} mode. Refreshing workspace...`,
        });

        // Trigger a reload to refresh the sidebar navigation and dashboard widgets
        setTimeout(() => {
            window.location.reload();
        }, 1000);
    };

    if (!mounted) return null;

    return (
        <div className="flex flex-col gap-6">
            <h1 className="font-headline text-3xl font-bold">Business Settings</h1>
            
            <Card>
                <CardHeader>
                    <CardTitle>Operating Model</CardTitle>
                    <CardDescription>Choose how CACU configures your workspace modules and dashboards.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {[
                            { val: 'PRODUCT', label: 'Product Business', icon: Package, desc: 'Retail, Wholesale & Inventory' },
                            { val: 'SERVICE', label: 'Service Business', icon: Briefcase, desc: 'Professional Services & Jobs' },
                            { val: 'HYBRID', label: 'Hybrid Model', icon: Sparkles, desc: 'Unified Goods & Services' },
                        ].map((type) => (
                            <button
                                key={type.val}
                                type="button"
                                onClick={() => setBusinessType(type.val as BusinessType)}
                                className={cn(
                                    "flex flex-col items-center gap-3 p-6 rounded-2xl border-2 transition-all text-center",
                                    businessType === type.val 
                                        ? "border-primary bg-primary/5 shadow-lg shadow-primary/10" 
                                        : "border-muted bg-card hover:border-primary/50"
                                )}
                            >
                                <type.icon className={cn("h-8 w-8", businessType === type.val ? "text-primary" : "text-muted-foreground")} />
                                <div>
                                    <p className="text-sm font-bold">{type.label}</p>
                                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">{type.desc}</p>
                                </div>
                            </button>
                        ))}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Core Identity</CardTitle>
                    <CardDescription>Legal and regulatory details for your business.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="biz-name">Business Name</Label>
                            <Input id="biz-name" defaultValue="CACU Technologies" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="sector">Sector</Label>
                            <Select defaultValue="technology">
                                <SelectTrigger id="sector">
                                    <SelectValue placeholder="Select sector" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="retail">Retail</SelectItem>
                                    <SelectItem value="technology">Technology</SelectItem>
                                    <SelectItem value="services">Services</SelectItem>
                                    <SelectItem value="manufacturing">Manufacturing</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="address">Headquarters Address</Label>
                            <Input id="address" defaultValue="Lagos, Nigeria" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="reg-num">Registration Number (RC)</Label>
                            <Input id="reg-num" placeholder="RC-1234567" />
                        </div>
                    </div>
                    <div className="flex justify-end gap-3 border-t pt-6">
                        <Button variant="outline">Discard Changes</Button>
                        <Button onClick={handleSave}>Save Configuration</Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
