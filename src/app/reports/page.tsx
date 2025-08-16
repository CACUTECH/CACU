import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

function ProfitAndLossStatement() {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle>Profit & Loss Statement</CardTitle>
                    <CardDescription>For the period ending July 31, 2024</CardDescription>
                </div>
                 <Button variant="outline" size="sm">
                    <Download className="mr-2 h-4 w-4" />
                    Export PDF
                </Button>
            </CardHeader>
            <CardContent>
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[300px]"></TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <TableRow className="font-bold">
                                <TableCell>Revenue</TableCell>
                                <TableCell></TableCell>
                            </TableRow>
                            <TableRow>
                                <TableCell className="pl-8">Client Revenue</TableCell>
                                <TableCell className="text-right">$12,500.00</TableCell>
                            </TableRow>
                            <TableRow className="font-bold border-t bg-muted/20">
                                <TableCell>Total Revenue</TableCell>
                                <TableCell className="text-right">$12,500.00</TableCell>
                            </TableRow>
                            <TableRow className="font-bold pt-4">
                                <TableCell>Expenses</TableCell>
                                <TableCell></TableCell>
                            </TableRow>
                            <TableRow>
                                <TableCell className="pl-8">Office Supplies</TableCell>
                                <TableCell className="text-right">$150.00</TableCell>
                            </TableRow>
                            <TableRow>
                                <TableCell className="pl-8">Contractors</TableCell>
                                <TableCell className="text-right">$1,200.00</TableCell>
                            </TableRow>
                            <TableRow>
                                <TableCell className="pl-8">Software</TableCell>
                                <TableCell className="text-right">$45.00</TableCell>
                            </TableRow>
                            <TableRow>
                                <TableCell className="pl-8">Marketing</TableCell>
                                <TableCell className="text-right">$300.00</TableCell>
                            </TableRow>
                            <TableRow className="font-bold border-t bg-muted/20">
                                <TableCell>Total Expenses</TableCell>
                                <TableCell className="text-right">$1,695.00</TableCell>
                            </TableRow>
                            <TableRow className="font-bold bg-card border-t-2">
                                <TableCell>Net Profit</TableCell>
                                <TableCell className="text-right text-green-500">$10,805.00</TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    )
}

function PlaceholderReport({ title }: { title: string }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>{title}</CardTitle>
                <CardDescription>Report data will be displayed here.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex h-64 items-center justify-center rounded-lg border-2 border-dashed">
                    <p className="text-muted-foreground">Report Coming Soon</p>
                </div>
            </CardContent>
        </Card>
    )
}

export default function ReportsPage() {
    return (
        <div className="flex flex-col gap-6">
            <h1 className="font-headline text-2xl font-bold">Financial Reports</h1>
            <Tabs defaultValue="pnl">
                <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:inline-flex">
                    <TabsTrigger value="pnl">Profit & Loss</TabsTrigger>
                    <TabsTrigger value="cashflow">Cash Flow</TabsTrigger>
                    <TabsTrigger value="balance-sheet">Balance Sheet</TabsTrigger>
                </TabsList>
                <TabsContent value="pnl" className="mt-4">
                    <ProfitAndLossStatement />
                </TabsContent>
                <TabsContent value="cashflow" className="mt-4">
                    <PlaceholderReport title="Cash Flow Statement" />
                </TabsContent>
                <TabsContent value="balance-sheet" className="mt-4">
                    <PlaceholderReport title="Balance Sheet" />
                </TabsContent>
            </Tabs>
        </div>
    );
}
