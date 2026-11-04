
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Circle } from 'lucide-react';

// A guide, not a record: CACU does not check these registrations, so nothing here is shown as done (Doc 01 PRIN-01).
// Which ones apply, and the current thresholds, depend on the business and the tax rules in force; an adviser confirms.
const steps = [
    { title: "Business registration", desc: "Register your business name or company with the Corporate Affairs Commission (CAC)." },
    { title: "Tax identification number (TIN)", desc: "Get the tax identification number your business uses with the tax authority." },
    { title: "VAT registration", desc: "Whether you must register for VAT depends on your turnover and the tax rules in force. Ask your accountant." },
    { title: "SCUML registration", desc: "Some businesses, such as dealers in high-value goods, must register with the Special Control Unit against Money Laundering." },
];

export default function RegistrationSettingsPage() {
    return (
        <div className="flex flex-col gap-6">
            <h1 className="font-headline text-3xl font-bold">Business Registration</h1>
            <Card>
                <CardHeader>
                    <CardTitle>Registrations to check</CardTitle>
                    <CardDescription>
                        Common registrations for businesses in Nigeria. CACU does not check them for you; confirm which apply to your business with an accountant or the agency.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ul className="space-y-4">
                        {steps.map(step => (
                            <li key={step.title} className="flex items-start gap-3 p-3 rounded-lg border bg-card/50">
                                <Circle className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" aria-hidden="true" />
                                <div>
                                    <div className="text-sm font-bold">{step.title}</div>
                                    <div className="text-xs text-muted-foreground">{step.desc}</div>
                                </div>
                            </li>
                        ))}
                    </ul>
                </CardContent>
            </Card>
        </div>
    );
}
