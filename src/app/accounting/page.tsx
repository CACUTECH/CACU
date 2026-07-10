import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { 
    BookText, 
    FilePenLine, 
    Scale, 
    ArrowRight, 
    Landmark, 
    Receipt, 
    Wallet, 
    FileText, 
    ClipboardList, 
    Sparkles 
} from 'lucide-react';
import Link from 'next/link';

function FeatureCard({ icon: Icon, title, description, href, badge }: { icon: React.ElementType, title: string, description: string, href: string, badge?: string }) {
    return (
        <Link href={href} className="block hover:shadow-lg transition-shadow rounded-xl">
            <Card className="h-full flex flex-col relative overflow-hidden">
                {badge && (
                    <div className="absolute top-0 right-0 bg-primary/10 text-primary text-[10px] font-bold px-2 py-1 rounded-bl-xl uppercase tracking-tighter">
                        {badge}
                    </div>
                )}
                <CardHeader>
                    <div className="flex items-center gap-4">
                        <div className="bg-primary/10 p-3 rounded-full">
                            <Icon className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                            <CardTitle className="text-lg">{title}</CardTitle>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="flex-grow">
                    <p className="text-sm text-muted-foreground">{description}</p>
                </CardContent>
                <CardContent className="pt-0">
                    <div className="text-sm font-medium text-primary flex items-center">
                        Manage <ArrowRight className="ml-2 h-4 w-4" />
                    </div>
                </CardContent>
            </Card>
        </Link>
    );
}

export default function AccountingPage() {
    return (
        <div className="flex flex-col gap-8 pb-12">
            <div>
                <h1 className="font-headline text-3xl font-bold">Accounting & Ledger Hub</h1>
                <p className="text-muted-foreground mt-1">Professional financial management and regulatory compliance tools.</p>
            </div>
            
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {/* Core Ledger */}
                <FeatureCard
                    icon={BookText}
                    title="Chart of Accounts"
                    description="Organize your business finances with a structured ledger of assets, liabilities, and equity."
                    href="/accounting/chart-of-accounts"
                />
                <FeatureCard
                    icon={FilePenLine}
                    title="Journal Adjustments"
                    description="Record manual ledger entries for corrections, payroll, or depreciation with debit/credit validation."
                    href="/accounting/journal-entries"
                />
                <FeatureCard
                    icon={Scale}
                    title="Trial Balance"
                    description="Review ledger integrity to ensure your books are balanced across the double-entry system."
                    href="/accounting/trial-balance"
                />

                {/* Operations */}
                <FeatureCard
                    icon={Landmark}
                    title="Banking & Reconciliations"
                    description="Match bank statement entries with internal records to ensure data accuracy and detect fraud."
                    href="/analytics/reconciliation"
                />
                <FeatureCard
                    icon={Receipt}
                    title="A/R & Invoicing"
                    description="Manage customer receivables, track outstanding invoices, and optimize payment collections."
                    href="/invoices"
                />
                <FeatureCard
                    icon={Wallet}
                    title="A/P & Expenses"
                    description="Monitor vendor obligations, manage aging bills, and optimize outgoing cash flows."
                    href="/analytics/aging-reports"
                />

                {/* Reporting & Compliance */}
                <FeatureCard
                    icon={FileText}
                    title="Financial Reporting"
                    description="Generate standard P&L, Balance Sheet, and Cash Flow statements for stakeholders."
                    href="/reports"
                />
                <FeatureCard
                    icon={ClipboardList}
                    title="Accounting Policies"
                    description="Define and manage your company's fiscal policies and regulatory reporting standards."
                    href="/accounting/policies"
                />
                <FeatureCard
                    icon={Sparkles}
                    title="AI Note to Account"
                    description="Generate professional financial footnotes and disclosure notes powered by CACU AI."
                    href="/accounting/policies"
                    badge="AI Powered"
                />
            </div>
        </div>
    );
}
