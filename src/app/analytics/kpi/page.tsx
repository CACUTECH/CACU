import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export default function KpiPage() {
    return (
        <div className="flex flex-col gap-6">
            <h1 className="font-headline text-3xl font-bold">Key Performance Indicators (KPIs)</h1>
            <p className="text-muted-foreground">
                Track your most important business metrics at a glance with a customizable dashboard.
            </p>
            <Card>
                <CardHeader>
                    <CardTitle>KPI Dashboard</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground">KPI details and charts will be displayed here.</p>
                </CardContent>
            </Card>
        </div>
    );
}
