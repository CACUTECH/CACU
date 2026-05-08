
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { CheckCircle2, Circle, FileText, ExternalLink } from 'lucide-react';

const steps = [
    { title: "CAC Registration", desc: "Register your business name with the Corporate Affairs Commission.", status: "completed" },
    { title: "Tax Identification Number (TIN)", desc: "Obtain your TIN from the Federal Inland Revenue Service.", status: "completed" },
    { title: "Value Added Tax (VAT) Reg", desc: "Register for VAT if turnover exceeds ₦25M.", status: "pending" },
    { title: "SCUML Registration", desc: "For designated non-financial businesses.", status: "pending" },
];

export default function RegistrationSettingsPage() {
    const completedCount = steps.filter(s => s.status === 'completed').length;
    const progress = (completedCount / steps.length) * 100;

    return (
        <div className="flex flex-col gap-6">
            <h1 className="font-headline text-3xl font-bold">Business Registration</h1>
            <Card>
                <CardHeader>
                    <CardTitle>Compliance Checklist</CardTitle>
                    <CardDescription>Track your regulatory milestones in Nigeria.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                            <span>Total Progress</span>
                            <span className="font-bold">{progress}%</span>
                        </div>
                        <Progress value={progress} className="h-2" />
                    </div>
                    
                    <div className="space-y-4">
                        {steps.map((step, i) => (
                            <div key={i} className="flex items-start gap-3 p-3 rounded-lg border bg-card/50">
                                {step.status === 'completed' ? (
                                    <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                                ) : (
                                    <Circle className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                                )}
                                <div className="flex-grow">
                                    <div className="text-sm font-bold">{step.title}</div>
                                    <div className="text-xs text-muted-foreground">{step.desc}</div>
                                </div>
                                <Button variant="ghost" size="icon" asChild>
                                    <a href="#" target="_blank"><ExternalLink className="h-4 w-4" /></a>
                                </Button>
                            </div>
                        ))}
                    </div>

                    <div className="bg-primary/5 p-4 rounded-xl border border-primary/10 flex items-center gap-4">
                        <div className="bg-primary/10 p-2 rounded-full">
                            <FileText className="h-6 w-6 text-primary" />
                        </div>
                        <div className="flex-grow">
                            <div className="text-sm font-bold">Need assistance?</div>
                            <div className="text-xs text-muted-foreground">Our partners can help you with registration filings.</div>
                        </div>
                        <Button size="sm">Get Started</Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
