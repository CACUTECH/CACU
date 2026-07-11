
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Database, UserCheck, CalendarDays, ClipboardCheck, Calculator, FileDown, ArrowRight, UserX } from 'lucide-react';
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

export default function HRPage() {
    return (
        <div className="flex flex-col gap-6">
            <h1 className="font-headline text-3xl font-bold">Human Resources</h1>
            <p className="text-muted-foreground">Manage your team, payroll, and HR processes efficiently.</p>
            
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <FeatureCard
                    icon={Database}
                    title="Employee Database"
                    description="Maintain detailed employee profiles, including roles, contact information, and documents."
                    href="/hr/employees"
                />
                <FeatureCard
                    icon={CalendarDays}
                    title="Attendance"
                    description="Log daily attendance for your team members to monitor presence and automate timesheets."
                    href="/hr/attendance"
                />
                <FeatureCard
                    icon={FileDown}
                    title="Payroll"
                    description="Generate payroll and allow employees to download their payslips directly from their profile."
                    href="/hr/payroll"
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
