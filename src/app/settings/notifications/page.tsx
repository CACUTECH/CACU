
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';

export default function NotificationSettingsPage() {
    const { toast } = useToast();

    return (
        <div className="flex flex-col gap-6">
            <h1 className="font-headline text-3xl font-bold">Notifications</h1>
            <Card>
                <CardHeader>
                    <CardTitle>Alert Preferences</CardTitle>
                    <CardDescription>Choose how you want to be notified about business activity.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="flex items-center justify-between space-x-2">
                        <div className="space-y-0.5">
                            <Label className="text-base">Email Notifications</Label>
                            <p className="text-sm text-muted-foreground">Receive daily summaries and critical alerts via email.</p>
                        </div>
                        <Switch defaultChecked onCheckedChange={() => toast({ title: "Email settings updated" })} />
                    </div>
                    <div className="flex items-center justify-between space-x-2">
                        <div className="space-y-0.5">
                            <Label className="text-base">SMS Alerts</Label>
                            <p className="text-sm text-muted-foreground">Get instant text messages for high-value transactions.</p>
                        </div>
                        <Switch onCheckedChange={() => toast({ title: "SMS settings updated" })} />
                    </div>
                    <div className="flex items-center justify-between space-x-2">
                        <div className="space-y-0.5">
                            <Label className="text-base">WhatsApp Updates</Label>
                            <p className="text-sm text-muted-foreground">Receive reports and low-stock alerts directly on WhatsApp.</p>
                        </div>
                        <Switch defaultChecked onCheckedChange={() => toast({ title: "WhatsApp settings updated" })} />
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
