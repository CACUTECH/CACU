
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { WifiOff, Database } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function OfflineSettingsPage() {
    const { toast } = useToast();

    return (
        <div className="flex flex-col gap-6">
            <h1 className="font-headline text-3xl font-bold">Offline Settings</h1>
            <Card className="border-primary/20 shadow-primary/5">
                <CardHeader>
                    <div className="flex items-center gap-3">
                        <WifiOff className="h-6 w-6 text-primary" />
                        <CardTitle>Offline Mode</CardTitle>
                    </div>
                    <CardDescription>Configure how CACU behaves when your internet connection is unstable.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="flex items-center justify-between space-x-2">
                        <div className="space-y-0.5">
                            <Label className="text-base">Enable Local Caching</Label>
                            <p className="text-sm text-muted-foreground">Keep data accessible even when offline.</p>
                        </div>
                        <Switch defaultChecked />
                    </div>
                    <div className="rounded-lg bg-muted p-4 space-y-2">
                        <div className="flex items-center gap-2 text-sm font-medium">
                            <Database className="h-4 w-4" />
                            Storage Usage
                        </div>
                        <div className="text-2xl font-bold">12.4 MB</div>
                        <p className="text-xs text-muted-foreground">Cached data for Dashboard, Inventory, and Invoices.</p>
                    </div>
                    <Button variant="destructive" onClick={() => toast({ title: "Local cache cleared" })}>Clear Offline Cache</Button>
                </CardContent>
            </Card>
        </div>
    );
}
