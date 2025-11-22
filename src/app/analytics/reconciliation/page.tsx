import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export default function ReconciliationPage() {
    return (
        <div className="flex flex-col gap-6">
            <h1 className="font-headline text-3xl font-bold">Accounts Reconciliation</h1>
            <p className="text-muted-foreground">
                Easily reconcile your linked bank accounts to ensure financial accuracy.
            </p>
            <Card>
                <CardHeader>
                    <CardTitle>Reconciliation Tool</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground">Account reconciliation interface will be available here.</p>
                </CardContent>
            </Card>
        </div>
    );
}
