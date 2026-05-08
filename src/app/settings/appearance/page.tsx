
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useTheme } from '@/components/theme-provider';
import { Sun, Moon, Monitor } from 'lucide-react';

export default function AppearanceSettingsPage() {
    const { theme, setTheme } = useTheme();

    return (
        <div className="flex flex-col gap-6">
            <h1 className="font-headline text-3xl font-bold">Appearance</h1>
            <Card>
                <CardHeader>
                    <CardTitle>Theme Selection</CardTitle>
                    <CardDescription>Choose how CACU looks on your device.</CardDescription>
                </CardHeader>
                <CardContent>
                    <RadioGroup defaultValue={theme} onValueChange={(v) => setTheme(v as any)} className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Label
                            htmlFor="light"
                            className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground [&:has([data-state=checked])]:border-primary"
                        >
                            <RadioGroupItem value="light" id="light" className="sr-only" />
                            <Sun className="mb-3 h-6 w-6 text-orange-500" />
                            Light
                        </Label>
                        <Label
                            htmlFor="dark"
                            className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground [&:has([data-state=checked])]:border-primary"
                        >
                            <RadioGroupItem value="dark" id="dark" className="sr-only" />
                            <Moon className="mb-3 h-6 w-6 text-primary" />
                            Dark
                        </Label>
                        <Label
                            htmlFor="system"
                            className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground [&:has([data-state=checked])]:border-primary"
                        >
                            <RadioGroupItem value="system" id="system" className="sr-only" />
                            <Monitor className="mb-3 h-6 w-6 text-muted-foreground" />
                            System
                        </Label>
                    </RadioGroup>
                </CardContent>
            </Card>
        </div>
    );
}
