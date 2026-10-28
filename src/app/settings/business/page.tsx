
"use client";

import { FileAttachments } from "@/components/file-attachments";
import { useBusiness } from "@/components/business-provider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BusinessModeSelector } from '@/components/business-mode-selector';

export default function BusinessSettingsPage() {
    const { business } = useBusiness();

    return (
        <div className="flex flex-col gap-6">
            <h1 className="font-headline text-3xl font-bold">Business Settings</h1>
            
            <Card>
                <CardHeader>
                    <CardTitle>Operating Model</CardTitle>
                    <CardDescription>Choose how CACU configures your workspace modules and dashboards.</CardDescription>
                </CardHeader>
                <CardContent>
                    <BusinessModeSelector />
                </CardContent>
            </Card>

            {business?.id && <Card><CardHeader><CardTitle>Business Logo</CardTitle><CardDescription>Upload or manage your business logo.</CardDescription></CardHeader><CardContent><FileAttachments purpose="logo" resourceId={business.id} /></CardContent></Card>}

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
                    <div className="flex items-center justify-end gap-3 border-t pt-6">
                        <p className="mr-auto text-sm text-muted-foreground">Identity details cannot be edited here yet.</p>
                        <Button variant="outline" disabled>Discard Changes</Button>
                        <Button disabled>Save Configuration</Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
