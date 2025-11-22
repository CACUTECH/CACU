import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export default function BudgetVsActualPage() {
    return (
        <div className="flex flex-col gap-6">
            <h1 className="font-headline text-3xl font-bold">Budget vs. Actual Analysis</h1>
            <p className="text-muted-foreground">
                Compare your actual financial performance against your budget to identify variances.
            </p>
            <Card>
                <CardHeader>
                    <CardTitle>Budget vs. Actual Report</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground">Analysis charts and data will be displayed here.</p>
                </CardContent>
            </Card>
        </div>
    );
}
