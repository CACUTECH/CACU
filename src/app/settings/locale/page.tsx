
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

export default function LocaleSettingsPage() {
    const { toast } = useToast();

    return (
        <div className="flex flex-col gap-6">
            <h1 className="font-headline text-3xl font-bold">Language & Currency</h1>
            <Card>
                <CardHeader>
                    <CardTitle>Regional Preferences</CardTitle>
                    <CardDescription>Set your preferred language and default reporting currency.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid gap-6 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="language">Interface Language</Label>
                            <Select defaultValue="en">
                                <SelectTrigger id="language">
                                    <SelectValue placeholder="Select Language" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="en">English</SelectItem>
                                    <SelectItem value="ha">Hausa</SelectItem>
                                    <SelectItem value="yo">Yoruba</SelectItem>
                                    <SelectItem value="ig">Igbo</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="currency">Base Currency</Label>
                            <Select defaultValue="ngn">
                                <SelectTrigger id="currency">
                                    <SelectValue placeholder="Select Currency" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ngn">Nigerian Naira (₦)</SelectItem>
                                    <SelectItem value="usd">US Dollar ($)</SelectItem>
                                    <SelectItem value="gbp">British Pound (£)</SelectItem>
                                    <SelectItem value="eur">Euro (€)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <Button onClick={() => toast({ title: "Preferences Saved" })}>Apply Changes</Button>
                </CardContent>
            </Card>
        </div>
    );
}
