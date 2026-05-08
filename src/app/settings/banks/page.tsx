
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle, Landmark, ExternalLink } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const linkedBanks = [
    { id: 1, name: "Sterling Bank", account: "**** 5678", balance: "₦1,240,000" },
    { id: 2, name: "Access Bank", account: "**** 1234", balance: "₦85,400" },
];

export default function BankLinkingPage() {
    const { toast } = useToast();

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <h1 className="font-headline text-3xl font-bold">Bank Linking</h1>
                <Button onClick={() => toast({ title: "Opening secure portal..." })}>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Link New Account
                </Button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
                {linkedBanks.map((bank) => (
                    <Card key={bank.id}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0">
                            <div className="flex items-center gap-3">
                                <div className="bg-primary/10 p-2 rounded-lg">
                                    <Landmark className="h-5 w-5 text-primary" />
                                </div>
                                <div>
                                    <CardTitle className="text-base">{bank.name}</CardTitle>
                                    <CardDescription>{bank.account}</CardDescription>
                                </div>
                            </div>
                            <Button variant="ghost" size="icon"><ExternalLink className="h-4 w-4" /></Button>
                        </CardHeader>
                        <CardContent>
                            <div className="text-xl font-bold font-headline">{bank.balance}</div>
                            <p className="text-xs text-muted-foreground">Last synced 2 hours ago</p>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
}
