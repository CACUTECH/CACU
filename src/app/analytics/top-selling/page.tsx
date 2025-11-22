import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export default function TopSellingPage() {
    return (
        <div className="flex flex-col gap-6">
            <h1 className="font-headline text-3xl font-bold">Top-Selling Products/Services</h1>
            <p className="text-muted-foreground">
                Identify your most popular offerings to optimize your sales and marketing efforts.
            </p>
            <Card>
                <CardHeader>
                    <CardTitle>Top Sellers Report</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground">A list of top-selling products and services will be displayed here.</p>
                </CardContent>
            </Card>
        </div>
    );
}
