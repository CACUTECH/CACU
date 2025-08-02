import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Smartphone, Banknote, PosTerminal, Mail, FileSpreadsheet } from 'lucide-react';

function FeatureCard({ icon: Icon, title, description }: { icon: React.ElementType, title: string, description: string }) {
    return (
        <Card>
            <CardHeader className="flex items-center gap-4">
                <div className="bg-primary/10 p-3 rounded-full">
                    <Icon className="h-8 w-8 text-primary" />
                </div>
                <CardTitle>{title}</CardTitle>
            </CardHeader>
            <CardContent>
                <p className="text-muted-foreground">{description}</p>
            </CardContent>
        </Card>
    );
}

export default function AppsPage() {
    return (
        <div className="flex flex-col gap-6">
            <h1 className="font-headline text-3xl font-bold">Integrations & Apps</h1>
            <p className="text-muted-foreground">Connect CACU with the tools you already use.</p>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <FeatureCard
                    icon={Smartphone}
                    title="Mobile Money Platforms"
                    description="Integrate with popular mobile money services for seamless payments and transfers."
                />
                <FeatureCard
                    icon={Banknote}
                    title="Bank Account Linking"
                    description="Connect your local bank and microfinance institution accounts for a unified financial view."
                />
                <FeatureCard
                    icon={PosTerminal}
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
                />
            </div>
        </div>
    );
}
