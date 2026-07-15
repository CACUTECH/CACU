"use client";

import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { 
    Settings, 
    Plus, 
    ArrowLeft, 
    ShieldCheck, 
    Landmark, 
    Calculator, 
    CheckCircle2, 
    Info,
    Trash2
} from "lucide-react";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";
import { salaryComponents as initialComponents } from "@/lib/data";
import { cn } from "@/lib/utils";

export default function PayrollConfigPage() {
    const { toast } = useToast();
    const [components, setComponents] = React.useState(initialComponents);

    const handleSave = () => {
        toast({ title: "Configuration Updated", description: "Global salary components and statutory rules saved." });
    };

    return (
        <div className="flex flex-col gap-6 pb-12">
            <div className="flex items-center gap-4">
                <Button asChild variant="ghost" size="icon" className="rounded-full">
                    <Link href="/hr/payroll"><ArrowLeft className="h-4 w-4" /></Link>
                </Button>
                <div>
                    <h1 className="font-headline text-3xl font-bold">Payroll Configuration</h1>
                    <p className="text-muted-foreground">Define your company's salary structure and regulatory rules.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle>Salary Components</CardTitle>
                                <CardDescription>Earnings and deductions that make up the monthly pay.</CardDescription>
                            </div>
                            <Button size="sm" variant="outline"><Plus className="mr-2 h-4 w-4" /> New Component</Button>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {components.map((c) => (
                                <div key={c.id} className="flex items-center justify-between p-4 rounded-xl border bg-muted/20 group">
                                    <div className="flex items-center gap-4">
                                        <div className={cn(
                                            "h-10 w-10 rounded-full flex items-center justify-center font-bold",
                                            c.type === 'Earning' ? "bg-emerald-500/10 text-emerald-700" : "bg-red-500/10 text-red-700"
                                        )}>
                                            {c.type === 'Earning' ? '+' : '-'}
                                        </div>
                                        <div>
                                            <p className="font-bold text-sm">{c.name}</p>
                                            <div className="flex gap-2 mt-1">
                                                <Badge variant="secondary" className="text-[9px] uppercase">{c.calculationType}</Badge>
                                                {c.isStatutory && <Badge className="text-[9px] uppercase bg-primary/10 text-primary">Statutory</Badge>}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <div className="text-right">
                                            <p className="font-bold text-sm">{c.value}{c.calculationType === 'Percentage' ? '%' : ' Fixed'}</p>
                                            <p className="text-[10px] text-muted-foreground">Effective Date: Jan 2024</p>
                                        </div>
                                        <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 text-destructive"><Trash2 className="h-4 w-4" /></Button>
                                    </div>
                                </div>
                            ))}
                        </CardContent>
                    </Card>

                    <Card className="border-primary/20 bg-primary/5">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <ShieldCheck className="h-5 w-5 text-primary" />
                                Statutory Compliance (Nigeria)
                            </CardTitle>
                            <CardDescription>Rules for PAYE, Pension, and NHF remittances.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <Label className="text-base font-bold">Auto-calculate PAYE</Label>
                                    <p className="text-xs text-muted-foreground">Uses the consolidated relief allowance table (FIRS/LIRS).</p>
                                </div>
                                <Switch defaultChecked />
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <Label className="text-base font-bold">Pension Contribution (8% / 10%)</Label>
                                    <p className="text-xs text-muted-foreground">Complies with the Pension Reform Act of 2014.</p>
                                </div>
                                <Switch defaultChecked />
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <div className="space-y-6">
                    <Card className="bg-muted/50 border-dashed border-2">
                        <CardHeader>
                            <CardTitle className="text-sm font-bold flex items-center gap-2">
                                <Info className="h-4 w-4 text-primary" />
                                Pro-ration Rules
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="text-xs text-muted-foreground space-y-4">
                            <p>Current rule: Salaries for new hires or exits are calculated based on <strong>Calendar Days</strong> in the month.</p>
                            <Button variant="link" className="p-0 h-auto text-primary">Modify Calculation Logic →</Button>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-sm font-bold flex items-center gap-2">
                                <Landmark className="h-4 w-4 text-primary" />
                                Payment Gateway
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="p-3 rounded-lg border bg-card text-xs font-medium">
                                <p>Bank: Sterling Bank API</p>
                                <p className="text-muted-foreground mt-1">Status: <span className="text-emerald-600 font-bold">CONNECTED</span></p>
                            </div>
                            <Button variant="outline" size="sm" className="w-full">Configure Bank Linking</Button>
                        </CardContent>
                    </Card>
                    <Button onClick={handleSave} className="w-full h-12 rounded-xl shadow-lg">Save Changes</Button>
                </div>
            </div>
        </div>
    );
}