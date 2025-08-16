import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Smartphone, Banknote, Terminal, Mail, FileSpreadsheet, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';

function FeatureCard({ icon: Icon, title, description, connected }: { icon: React.ElementType, title: string, description: string, connected?: boolean }) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-start gap-4">
                <div className="bg-primary/10 p-4 rounded-full">
                    <Icon className="h-8 w-8 text-primary" />
                </div>
                <div>
                    <CardTitle>{title}</CardTitle>
                    <CardDescription className="mt-1">{description}</CardDescription>
                </div>
            </CardHeader>
            <CardContent>
                <Button variant={connected ? 'destructive' : 'default'} className="w-full">
                    {connected ? 'Disconnect' : 'Connect'}
                </Button>
            </CardContent>
        </Card>
    );
}

export default function AppsPage() {
    return (
        <div className="flex flex-col gap-6">
            <h1 className="font-headline text-3xl font-bold">Integrations & Apps</h1>
            <p className="text-muted-foreground">Connect CACU with the tools you already use to streamline your workflow.</p>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <FeatureCard
                    icon={Smartphone}
                    title="Mobile Money Platforms"
                    description="Integrate with popular mobile money services for seamless payments and transfers."
                    connected
                />
                <FeatureCard
                    icon={Banknote}
                    title="Bank Account Linking"
                    description="Connect your local bank and microfinance institution accounts for a unified financial view."
                />
                <FeatureCard
                    icon={Terminal}
                    title="POS System Integration"
                    description="Sync your Point-of-Sale system to automatically record sales and inventory data."
                />
                <FeatureCard
                    icon={Mail}
                    title="Auto-Reporting Tools"
                    description="Set up automatic reports sent directly to your email or WhatsApp."
                />
                <FeatureCard
                    icon={FileSpreadsheet}
                    title="Excel/Google Sheets Sync"
                    description="Keep your spreadsheets up-to-date with two-way synchronization of your financial data."
                    connected
                />
                 <FeatureCard
                    icon={Bot}
                    title="AI Assistant"
                    description="Enable the CACU AI assistant for smart insights and automation."
                />
            </div>
        </div>
    );
}
