import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Database, UserCheck, CalendarDays, ClipboardCheck, Calculator, FileDown } from 'lucide-react';

function FeatureCard({ icon: Icon, title, description }: { icon: React.ElementType, title: string, description: string }) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center gap-4">
                <div className="bg-primary/10 p-3 rounded-full">
                    <Icon className="h-6 w-6 text-primary" />
                </div>
                <div>
                    <CardTitle>{title}</CardTitle>
                </div>
            </CardHeader>
            <CardContent>
                <p className="text-muted-foreground">{description}</p>
            </CardContent>
        </Card>
    );
}

export default function HRPage() {
    return (
        <div className="flex flex-col gap-6">
            <h1 className="font-headline text-3xl font-bold">Human Resources</h1>
            <p className="text-muted-foreground">Manage your team and payroll efficiently.</p>
            
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <FeatureCard
                    icon={Database}
                    title="Employee Database"
                    description="Maintain detailed employee profiles, including roles, contact information, and documents."
                />
                <FeatureCard
                    icon={UserCheck}
                    title="Employment Status Tracker"
                    description="Track employee statuses such as active, on probation, or terminated."
                />
                <FeatureCard
                    icon={CalendarDays}
                    title="Daily Check-in/Check-out"
                    description="Log daily attendance for your team members to monitor presence."
                />
                <FeatureCard
                    icon={ClipboardCheck}
                    title="Timesheet Approval System"
                    description="Manage and approve employee timesheets for accurate payroll processing."
                />
                <FeatureCard
                    icon={Calculator}
                    title="Salary Calculator"
                    description="Calculate salaries with automatic tax and pension deductions based on local regulations."
                />
                <FeatureCard
                    icon={FileDown}
                    title="Payroll & Payslips"
                    description="Generate payroll and allow employees to download their payslips directly."
                />
            </div>
        </div>
    );
}
