import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export default function PlanningPage() {
    return (
        <div className="flex flex-col gap-6">
            <h1 className="font-headline text-3xl font-bold">Planning & Budgeting</h1>
            <p className="text-muted-foreground">
                Create detailed budgets and financial plans to guide your business strategy.
            </p>
            <Card>
                <CardHeader>
                    <CardTitle>Financial Plan</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground">Planning and budgeting tools will be available here.</p>
                </CardContent>
            </Card>
        </div>
    );
}
