
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';

export default function TaxSettingsPage() {
    const { toast } = useToast();

    return (
        <div className="flex flex-col gap-6">
            <h1 className="font-headline text-3xl font-bold">Tax Settings</h1>
            <Card>
                <CardHeader>
                    <CardTitle>Value Added Tax (VAT)</CardTitle>
                    <CardDescription>Configure VAT rates for automated invoice calculations.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="flex items-center justify-between space-x-2">
                        <div className="space-y-0.5">
                            <Label className="text-base">Automatic VAT Calculation</Label>
                            <p className="text-sm text-muted-foreground">Automatically add VAT to all new invoices.</p>
                        </div>
                        <Switch defaultChecked />
                    </div>
                    <div className="grid gap-4 max-w-xs">
                        <div className="space-y-2">
                            <Label htmlFor="vat-rate">Current VAT Rate (%)</Label>
                            <div className="relative">
                                <Input id="vat-rate" type="number" defaultValue="7.5" step="0.1" className="pr-8" />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                            </div>
                        </div>
                    </div>
                    <Button onClick={() => toast({ title: "Tax settings saved" })}>Save Tax Rules</Button>
                </CardContent>
            </Card>
        </div>
    );
}
