
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

export default function BusinessSettingsPage() {
    const { toast } = useToast();

    const handleSave = () => {
        toast({
            title: "Business Profile Saved",
            description: "Your business details have been updated.",
        });
    };

    return (
        <div className="flex flex-col gap-6">
            <h1 className="font-headline text-3xl font-bold">Business Settings</h1>
            <Card>
                <CardHeader>
                    <CardTitle>Core Business Details</CardTitle>
                    <CardDescription>Configure your business identity and industry presence.</CardDescription>
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
                    <Button onClick={handleSave}>Update Business Profile</Button>
                </CardContent>
            </Card>
        </div>
    );
}
