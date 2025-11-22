import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export default function AgingReportsPage() {
    return (
        <div className="flex flex-col gap-6">
            <h1 className="font-headline text-3xl font-bold">Receivables & Payables Aging</h1>
            <p className="text-muted-foreground">
                Monitor outstanding invoices and bills to manage your cash flow effectively.
            </p>
            <Card>
                <CardHeader>
                    <CardTitle>Aging Reports</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground">Detailed aging reports for receivables and payables will be displayed here.</p>
                </CardContent>
            </Card>
        </div>
    );
}
