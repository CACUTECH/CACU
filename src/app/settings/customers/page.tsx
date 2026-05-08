
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Heart } from 'lucide-react';

export default function CustomerSettingsPage() {
    const { toast } = useToast();

    return (
        <div className="flex flex-col gap-6">
            <h1 className="font-headline text-3xl font-bold">Customer Loyalty</h1>
            <Card className="border-primary/20 shadow-primary/5">
                <CardHeader>
                    <div className="flex items-center gap-3">
                        <Heart className="h-6 w-6 text-primary" />
                        <CardTitle>Loyalty Program Configuration</CardTitle>
                    </div>
                    <CardDescription>Reward your most valuable customers with a points-based system.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="flex items-center justify-between space-x-2">
                        <div className="space-y-0.5">
                            <Label className="text-base">Enable Points System</Label>
                            <p className="text-sm text-muted-foreground">Customers earn points on every purchase.</p>
                        </div>
                        <Switch defaultChecked />
                    </div>
                    <div className="grid gap-6 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="earning-rate">Points per ₦1,000 spent</Label>
                            <Input id="earning-rate" type="number" defaultValue="10" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="redemption-rate">₦ Value per Point</Label>
                            <Input id="redemption-rate" type="number" defaultValue="1" />
                        </div>
                    </div>
                    <Button onClick={() => toast({ title: "Loyalty rules updated" })}>Save Configuration</Button>
                </CardContent>
            </Card>
        </div>
    );
}
