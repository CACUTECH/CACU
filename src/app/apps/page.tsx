"use client";

import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Smartphone, Banknote, Terminal, Mail, FileSpreadsheet, Bot, CheckCircle2, AlertCircle, PlusCircle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import Link from "next/link";

interface IntegrationCardProps {
    icon: React.ElementType;
    title: string;
    description: string;
    connected?: boolean;
    children?: React.ReactNode;
    onAction?: () => void;
}

function IntegrationCard({ icon: Icon, title, description, connected, children, onAction }: IntegrationCardProps) {
    return (
        <Card className="flex flex-col border-primary/5 shadow-primary/5">
            <CardHeader className="flex flex-row items-start gap-4">
                <div className="bg-primary/10 p-4 rounded-2xl shrink-0">
                    <Icon className="h-8 w-8 text-primary" />
                </div>
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <CardTitle className="text-lg">{title}</CardTitle>
                        {connected && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                    </div>
                    <CardDescription className="text-sm line-clamp-2">{description}</CardDescription>
                </div>
            </CardHeader>
            <CardContent className="mt-auto pt-0">
                {children ? children : (
                     <Button 
                        variant={connected ? 'outline' : 'default'} 
                        className="w-full rounded-xl"
                        onClick={onAction}
                    >
                        {connected ? 'Manage Connection' : 'Connect'}
                    </Button>
                )}
            </CardContent>
        </Card>
    );
}

export default function AppsPage() {
    const { toast } = useToast();
    const [integrations, setIntegrations] = React.useState({
        mobileMoney: true,
        bank: false,
        pos: false,
        reporting: false,
        sheets: true,
        ai: true,
    });

    const toggleIntegration = (key: keyof typeof integrations) => {
        setIntegrations(prev => ({ ...prev, [key]: !prev[key] }));
        toast({
            title: integrations[key] ? "Integration Disconnected" : "Integration Active",
            description: `${key.charAt(0).toUpperCase() + key.slice(1)} status has been updated.`,
        });
    };

    return (
        <div className="flex flex-col gap-8">
            <div>
                <h1 className="font-headline text-3xl font-bold tracking-tight">Integrations & Apps</h1>
                <p className="text-muted-foreground mt-1">Power up CACU with your favorite business tools and financial services.</p>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {/* Mobile Money */}
                <IntegrationCard
                    icon={Smartphone}
                    title="Mobile Money"
                    description="Connect OPay, PalmPay, or Paga for real-time payment notifications and automated reconciliation."
                    connected={integrations.mobileMoney}
                >
                    <Dialog>
                        <DialogTrigger asChild>
                            <Button variant={integrations.mobileMoney ? 'outline' : 'default'} className="w-full rounded-xl">
                                {integrations.mobileMoney ? 'Manage Wallets' : 'Connect Platform'}
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Mobile Money Integration</DialogTitle>
                                <DialogDescription>Select your primary mobile money provider in Nigeria.</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                                <div className="space-y-2">
                                    <Label>Provider</Label>
                                    <Select defaultValue="opay">
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="opay">OPay Business</SelectItem>
                                            <SelectItem value="palmpay">PalmPay for Business</SelectItem>
                                            <SelectItem value="paga">Paga for Business</SelectItem>
                                            <SelectItem value="moniepoint">Moniepoint</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Wallet Number</Label>
                                    <Input placeholder="08012345678" />
                                </div>
                            </div>
                            <DialogFooter>
                                <DialogClose asChild>
                                    <Button className="w-full" onClick={() => !integrations.mobileMoney && toggleIntegration('mobileMoney')}>
                                        Save Configuration
                                    </Button>
                                </DialogClose>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </IntegrationCard>

                {/* Bank Account */}
                <IntegrationCard
                    icon={Banknote}
                    title="Bank Linking"
                    description="Sync your Sterling, Access, or Zenith bank statements directly to your CACU dashboard."
                    connected={integrations.bank}
                >
                    <Button asChild variant="outline" className="w-full rounded-xl border-primary/20 text-primary hover:bg-primary/5">
                        <Link href="/settings/banks">
                            Go to Bank Settings <ArrowRight className="ml-2 h-4 w-4" />
                        </Link>
                    </Button>
                </IntegrationCard>

                {/* POS Integration */}
                <IntegrationCard
                    icon={Terminal}
                    title="POS Systems"
                    description="Automatically record sales from your physical POS terminals directly into your inventory and accounting."
                    connected={integrations.pos}
                >
                     <Dialog>
                        <DialogTrigger asChild>
                            <Button variant={integrations.pos ? 'outline' : 'default'} className="w-full rounded-xl">
                                {integrations.pos ? 'Manage POS' : 'Connect Terminal'}
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Link POS Terminal</DialogTitle>
                                <DialogDescription>Enter your terminal ID to start syncing sales data.</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                                <div className="space-y-2">
                                    <Label>Terminal Provider</Label>
                                    <Select>
                                        <SelectTrigger><SelectValue placeholder="Select provider" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="moniepoint">Moniepoint</SelectItem>
                                            <SelectItem value="opay">OPay</SelectItem>
                                            <SelectItem value="flutterwave">Flutterwave</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Terminal ID</Label>
                                    <Input placeholder="TID-12345678" />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button className="w-full" onClick={() => toggleIntegration('pos')}>
                                    {integrations.pos ? 'Update' : 'Verify & Connect'}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </IntegrationCard>

                {/* Auto-Reporting */}
                <IntegrationCard
                    icon={Mail}
                    title="Smart Reporting"
                    description="Get daily, weekly, or monthly financial summaries sent directly to your email or WhatsApp."
                    connected={integrations.reporting}
                >
                    <Dialog>
                        <DialogTrigger asChild>
                            <Button variant={integrations.reporting ? 'outline' : 'default'} className="w-full rounded-xl">
                                {integrations.reporting ? 'Schedule Settings' : 'Setup Reports'}
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Report Automation</DialogTitle>
                                <DialogDescription>Configure when and where you receive your insights.</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-6 py-4">
                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <Label>Email Reports</Label>
                                        <p className="text-xs text-muted-foreground">PDF summary to your inbox.</p>
                                    </div>
                                    <Switch defaultChecked />
                                </div>
                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <Label>WhatsApp Updates</Label>
                                        <p className="text-xs text-muted-foreground">Instant alerts for low stock.</p>
                                    </div>
                                    <Switch />
                                </div>
                                <div className="space-y-2">
                                    <Label>Frequency</Label>
                                    <Select defaultValue="daily">
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="daily">Daily @ 8:00 PM</SelectItem>
                                            <SelectItem value="weekly">Weekly (Sundays)</SelectItem>
                                            <SelectItem value="monthly">Monthly (1st day)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button className="w-full" onClick={() => !integrations.reporting && toggleIntegration('reporting')}>Save Schedule</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </IntegrationCard>

                {/* Spreadsheets */}
                <IntegrationCard
                    icon={FileSpreadsheet}
                    title="Excel & Sheets Sync"
                    description="Keep your existing spreadsheets up-to-date with two-way synchronization of your transaction data."
                    connected={integrations.sheets}
                >
                    <div className="grid grid-cols-2 gap-2">
                        <Button variant="outline" className="rounded-xl h-auto py-3 px-2 flex flex-col gap-1 border-primary/10">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase">Sync to</span>
                            <span className="text-xs font-semibold">Google Sheets</span>
                        </Button>
                        <Button variant="outline" className="rounded-xl h-auto py-3 px-2 flex flex-col gap-1 border-primary/10">
                             <span className="text-[10px] font-bold text-muted-foreground uppercase">Export to</span>
                            <span className="text-xs font-semibold">Excel (.xlsx)</span>
                        </Button>
                    </div>
                </IntegrationCard>

                {/* AI Assistant */}
                <IntegrationCard
                    icon={Bot}
                    title="CACU AI Agent"
                    description="Enable context-aware business insights and automated data analysis powered by Gemini 2.0."
                    connected={integrations.ai}
                >
                    <div className="flex items-center justify-between p-3 bg-primary/5 rounded-xl border border-primary/10">
                        <div className="space-y-1">
                            <span className="text-xs font-bold text-primary flex items-center gap-1 uppercase">
                                <Bot className="h-3 w-3" /> Assistant Active
                            </span>
                            <p className="text-[10px] text-muted-foreground">Monitoring your page data.</p>
                        </div>
                        <Switch 
                            checked={integrations.ai} 
                            onCheckedChange={() => toggleIntegration('ai')}
                        />
                    </div>
                </IntegrationCard>
            </div>

            <Card className="bg-gradient-to-br from-primary to-accent border-none text-primary-foreground overflow-hidden relative">
                <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-32 -mt-32 blur-3xl" />
                <CardHeader>
                    <CardTitle className="text-xl">Request a Custom Integration</CardTitle>
                    <CardDescription className="text-primary-foreground/80">
                        Can't find the tool you use? Let our engineering team build a custom connector for your business.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Button variant="secondary" className="bg-white text-primary hover:bg-white/90">
                        Submit Request
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
