import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Target, FileText, Scale, Coins, ShoppingCart, BookUser, ArrowDown, ArrowUp } from 'lucide-react';

function FeatureCard({ icon: Icon, title, description }: { icon: React.ElementType, title: string, description: string }) {
    return (
        <Card>
            <CardHeader>
                <div className="flex items-center gap-3">
                     <div className="bg-primary/10 p-3 rounded-full">
                        <Icon className="h-6 w-6 text-primary" />
                    </div>
                    <CardTitle>{title}</CardTitle>
                </div>
            </CardHeader>
            <CardContent>
                <p className="text-muted-foreground">{description}</p>
            </CardContent>
        </Card>
    );
}

export default function AnalyticsPage() {
    return (
        <div className="flex flex-col gap-6">
            <h1 className="font-headline text-3xl font-bold">Analytics & Reporting</h1>
            <p className="text-muted-foreground">Gain deep insights into your business performance with powerful analytics.</p>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <FeatureCard
                    icon={Target}
                    title="Key Performance Indicators (KPIs)"
                    description="Track your most important business metrics at a glance with a customizable dashboard."
                />
                <FeatureCard
                    icon={FileText}
                    title="Planning & Budgeting"
                    description="Create detailed budgets and financial plans to guide your business strategy."
                />
                <FeatureCard
                    icon={Scale}
                    title="Budget vs. Actual Analysis"
                    description="Compare your actual financial performance against your budget to identify variances."
                />
                <FeatureCard
                    icon={Coins}
                    title="Accounts Reconciliation"
                    description="Easily reconcile your linked bank accounts to ensure financial accuracy."
                />
                <FeatureCard
                    icon={ShoppingCart}
                    title="Top-Selling Products/Services"
                    description="Identify your most popular offerings to optimize your sales and marketing efforts."
                />
                <FeatureCard
                    icon={BookUser}
                    title="Receivables & Payables Aging"
                    description="Monitor outstanding invoices and bills to manage your cash flow effectively."
                />
                 <FeatureCard
                    icon={ArrowDown}
                    title="Receivables Aging Reports"
                    description="Track overdue customer payments and manage your collections process."
                />
                <FeatureCard
                    icon={ArrowUp}
                    title="Payables Aging Reports"
                    description="Keep an eye on upcoming bill payments to manage your expenses."
                />
            </div>
        </div>
    );
}
