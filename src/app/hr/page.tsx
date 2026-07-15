
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { 
    Database, 
    CalendarDays, 
    Calculator, 
    FileDown, 
    ArrowRight, 
    UserX, 
    ShieldCheck, 
    Landmark 
} from 'lucide-react';
import Link from 'next/link';

function FeatureCard({ icon: Icon, title, description, href, badge }: { icon: React.ElementType, title: string, description: string, href: string, badge?: string }) {
    return (
        <Link href={href} className="block hover:shadow-lg transition-shadow rounded-xl">
            <Card className="h-full flex flex-col relative overflow-hidden">
                {badge && (
                    <div className="absolute top-0 right-0 bg-primary/10 text-primary text-[10px] font-bold px-2 py-1 rounded-bl-xl uppercase">
                        {badge}
                    </div>
                )}
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
                    <p className="text-muted-foreground text-sm">{description}</p>
                </CardContent>
                <CardContent className="pt-0">
                    <div className="text-sm font-medium text-primary flex items-center">
                        Go to page <ArrowRight className="ml-2 h-4 w-4" />
                    </div>
                </CardContent>
            </Card>
        </Link>
    );
}

export default function HRPage() {
    return (
        <div className="flex flex-col gap-6">
            <h1 className="font-headline text-3xl font-bold">Human Resources</h1>
            <p className="text-muted-foreground">Manage your team, payroll, and HR processes efficiently.</p>
            
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <FeatureCard
                    icon={Database}
                    title="Employee Database"
                    description="Maintain detailed employee profiles, including roles, bank info, and tax details."
                    href="/hr/employees"
                />
                <FeatureCard
                    icon={CalendarDays}
                    title="Attendance"
                    description="Log daily attendance for your team members to monitor presence and automate timesheets."
                    href="/hr/attendance"
                    badge="Linked to Pay"
                />
                <FeatureCard
                    icon={Calculator}
                    title="Payroll Engine"
                    description="Automated gross-to-net processing with Maker-Checker approval workflows."
                    href="/hr/payroll"
                    badge="Core"
                />
                <FeatureCard
                    icon={Landmark}
                    title="Loans & Advances"
                    description="Manage employee loan requests and automated monthly deductions."
                    href="/hr/payroll/loans"
                />
                <FeatureCard
                    icon={ShieldCheck}
                    title="Compliance & Tax"
                    description="Manage statutory deductions (PAYE, Pension, NHF) and generate remittance files."
                    href="/hr/payroll/config"
                />
                <FeatureCard
                    icon={UserX}
                    title="Exits & Termination"
                    description="Manage employee exits, record reasons, and generate professional termination notices."
                    href="/hr/termination"
                />
            </div>
        </div>
    );
}
