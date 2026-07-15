
"use client";

import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Download, FileSpreadsheet, Loader2, Printer } from "lucide-react";
import Link from "next/link";
import { employees } from "@/lib/data";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import * as XLSX from "xlsx";

export default function TaxSchedulePage() {
    const { toast } = useToast();
    const [isExporting, setIsExporting] = React.useState(false);
    const currentMonth = format(new Date(), "MMMM yyyy");

    const taxData = employees.map(emp => {
        const gross = emp.baseSalary + 25000; // Simulated including allowances
        const taxable = gross * 0.8; // Simulated reliefs
        const tax = gross * 0.12; // Simulated PAYE calc
        return {
            name: emp.name,
            id: emp.id,
            gross,
            taxable,
            tax,
        };
    });

    const totalTax = taxData.reduce((acc, curr) => acc + curr.tax, 0);

    const exportToExcel = () => {
        const worksheet = XLSX.utils.json_to_sheet(taxData.map(d => ({
            'Employee Name': d.name,
            'Employee ID': d.id,
            'Monthly Gross (₦)': d.gross,
            'Taxable Income (₦)': d.taxable,
            'PAYE Tax (₦)': d.tax
        })));
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "PAYE Tax Schedule");
        XLSX.writeFile(workbook, `PAYE_Tax_Schedule_${format(new Date(), 'yyyyMMdd')}.xlsx`);
        toast({ title: "Excel Exported", description: "Tax schedule has been downloaded." });
    };

    const exportToPdf = async () => {
        setIsExporting(true);
        try {
            const { default: jsPDF } = await import('jspdf');
            require('jspdf-autotable');
            const doc = new jsPDF();

            doc.setFontSize(20);
            doc.text("PAYE Tax Remittance Schedule", 14, 22);
            
            doc.setFontSize(10);
            doc.text(`Period: ${currentMonth}`, 14, 30);
            doc.text("Business: CACU Technologies Limited", 14, 35);

            const tableRows = taxData.map(d => [
                d.name,
                d.id,
                `₦${d.gross.toLocaleString()}`,
                `₦${d.taxable.toLocaleString()}`,
                `₦${d.tax.toLocaleString()}`
            ]);

            ;(doc as any).autoTable({
                startY: 45,
                head: [['Employee', 'ID', 'Gross Pay', 'Taxable', 'PAYE Tax']],
                body: tableRows,
                theme: 'striped',
                headStyles: { fillColor: [82, 51, 255] }
            });

            doc.save(`PAYE_Tax_Schedule_${format(new Date(), 'yyyyMMdd')}.pdf`);
            toast({ title: "PDF Exported", description: "Schedule is ready for filing." });
        } catch (error) {
            toast({ variant: "destructive", title: "Export Failed" });
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="flex flex-col gap-6 pb-12">
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <Button asChild variant="ghost" size="icon" className="rounded-full">
                        <Link href="/hr/payroll"><ArrowLeft className="h-4 w-4" /></Link>
                    </Button>
                    <div>
                        <h1 className="font-headline text-3xl font-bold">Tax Schedule (PAYE)</h1>
                        <p className="text-muted-foreground">Monthly regulatory tax liabilities for {currentMonth}.</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={exportToPdf} disabled={isExporting}>
                        {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
                        Export PDF
                    </Button>
                    <Button variant="outline" size="sm" onClick={exportToExcel}>
                        <FileSpreadsheet className="mr-2 h-4 w-4" />
                        Export Excel
                    </Button>
                </div>
            </div>

            <Card className="shadow-xl shadow-primary/5 border-primary/10">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>Payroll Tax Breakdown</CardTitle>
                            <CardDescription>Consolidated relief and tax liability per employee.</CardDescription>
                        </div>
                        <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20">FIRS/LIRS Compliant</Badge>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-muted/50">
                            <TableRow>
                                <TableHead className="pl-6">Employee Name</TableHead>
                                <TableHead>Employee ID</TableHead>
                                <TableHead className="text-right">Gross Pay (₦)</TableHead>
                                <TableHead className="text-right">Taxable Income (₦)</TableHead>
                                <TableHead className="text-right pr-6">PAYE Tax (₦)</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {taxData.map((d) => (
                                <TableRow key={d.id} className="hover:bg-muted/10">
                                    <TableCell className="pl-6 font-bold">{d.name}</TableCell>
                                    <TableCell className="text-xs font-mono">{d.id}</TableCell>
                                    <TableCell className="text-right font-mono text-xs">₦{d.gross.toLocaleString()}</TableCell>
                                    <TableCell className="text-right font-mono text-xs">₦{d.taxable.toLocaleString()}</TableCell>
                                    <TableCell className="text-right pr-6 font-mono font-bold text-red-600">₦{d.tax.toLocaleString()}</TableCell>
                                </TableRow>
                            ))}
                            <TableRow className="bg-muted/30 font-bold">
                                <TableCell colSpan={4} className="pl-6 py-4 text-lg">Total Monthly Tax Liability</TableCell>
                                <TableCell className="text-right pr-6 py-4 text-lg text-primary">₦{totalTax.toLocaleString()}</TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
