import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BookText, FilePenLine, Scale, ArrowRight } from 'lucide-react';
import Link from 'next/link';

function FeatureCard({ icon: Icon, title, description, href }: { icon: React.ElementType, title: string, description: string, href: string }) {
    return (
        <Link href={href} className="block hover:shadow-lg transition-shadow rounded-xl">
            <Card className="h-full flex flex-col">
                <CardHeader>
                    <div className="flex items-center gap-4">
                        <div className="bg-primary/10 p-3 rounded-full">
                            <Icon className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                            <CardTitle>{title}</CardTitle>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="flex-grow">
                    <p className="text-muted-foreground">{description}</p>
                </CardContent>
                <CardContent>
                    <div className="text-sm font-medium text-primary flex items-center">
                        Go to page <ArrowRight className="ml-2 h-4 w-4" />
                    </div>
                </CardContent>
            </Card>
        </Link>
    );
}

export default function AccountingPage() {
    return (
        <div className="flex flex-col gap-6">
            <h1 className="font-headline text-3xl font-bold">Accounting & Ledger</h1>
            <p className="text-muted-foreground">Manage your core financial records with professional bookkeeping tools.</p>
            
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <FeatureCard
                    icon={BookText}
                    title="Chart of Accounts"
                    description="Organize your business finances with a structured ledger of assets, liabilities, and more."
                    href="/accounting/chart-of-accounts"
                />
                <FeatureCard
                    icon={FilePenLine}
                    title="Journal Adjustments"
                    description="Record manual ledger entries for corrections, payroll, or depreciation."
                    href="/accounting/journal-entries"
                />
                <FeatureCard
                    icon={Scale}
                    title="Trial Balance"
                    description="Review ledger integrity as at a specific date to ensure your books are balanced."
                    href="/accounting/trial-balance"
                />
            </div>
        </div>
    );
}
