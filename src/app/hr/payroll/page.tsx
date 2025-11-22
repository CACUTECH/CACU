import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileDown } from "lucide-react";

export default function PayrollPage() {
    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="font-headline text-3xl font-bold">Payroll</h1>
                    <p className="text-muted-foreground">
                        Manage and process your company's payroll.
                    </p>
                </div>
                <Button>
                    <FileDown className="mr-2 h-4 w-4" />
                    Run Payroll
                </Button>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Payroll Summary - July 2024</CardTitle>
                    <CardDescription>
                        Summary of the current payroll period.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid gap-4 md:grid-cols-3">
                         <div className="rounded-xl border bg-card text-card-foreground shadow p-6">
                            <h3 className="text-sm font-medium text-muted-foreground">Total Gross Pay</h3>
                            <p className="text-2xl font-bold font-headline">₦1,550,000</p>
                         </div>
                         <div className="rounded-xl border bg-card text-card-foreground shadow p-6">
                            <h3 className="text-sm font-medium text-muted-foreground">Total Deductions</h3>
                            <p className="text-2xl font-bold font-headline">₦232,500</p>
                         </div>
                         <div className="rounded-xl border bg-card text-card-foreground shadow p-6">
                            <h3 className="text-sm font-medium text-muted-foreground">Total Net Pay</h3>
                            <p className="text-2xl font-bold font-headline">₦1,317,500</p>
                         </div>
                    </div>
                </CardContent>
            </Card>
             <Card>
                <CardHeader>
                    <CardTitle>Payroll History</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground">A list of past payroll runs will be displayed here.</p>
                </CardContent>
            </Card>
        </div>
    );
}
