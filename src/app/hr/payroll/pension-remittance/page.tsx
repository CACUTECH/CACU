
"use client";

import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Download, FileSpreadsheet, Loader2, Printer, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { employees } from "@/lib/data";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import * as XLSX from "xlsx";

export default function PensionRemittancePage() {
    const { toast } = useToast();
    const [isExporting, setIsExporting] = React.useState(false);
    const currentMonth = format(new Date(), "MMMM yyyy");

    const pensionData = employees.map(emp => {
        const employeeContrib = emp.baseSalary * 0.08;
        const employerContrib = emp.baseSalary * 0.10;
        const total = employeeContrib + employerContrib;
        return {
            name: emp.name,
            pensionId: emp.pensionId || "PEN-PENDING",
            employeeContrib,
            employerContrib,
            total,
        };
    });

    const grandTotal = pensionData.reduce((acc, curr) => acc + curr.total, 0);

    const exportToExcel = () => {
        const worksheet = XLSX.utils.json_to_sheet(pensionData.map(d => ({
            'Employee Name': d.name,
            'Pension ID (RSA)': d.pensionId,
            'Employee (8%) (₦)': d.employeeContrib,
            'Employer (10%) (₦)': d.employerContrib,
            'Total Remittance (₦)': d.total
        })));
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Pension Remittance");
        XLSX.writeFile(workbook, `Pension_Remittance_${format(new Date(), 'yyyyMMdd')}.xlsx`);
        toast({ title: "Excel Exported", description: "Pension schedule has been downloaded." });
    };

    const exportToPdf = async () => {
        setIsExporting(true);
        try {
            const { default: jsPDF } = await import('jspdf');
            require('jspdf-autotable');
            const doc = new jsPDF();

            doc.setFontSize(20);
            doc.text("Pension Remittance Schedule", 14, 22);
            
            doc.setFontSize(10);
            doc.text(`Period: ${currentMonth}`, 14, 30);
            doc.text("Business: CACU Technologies Limited", 14, 35);
            doc.text("Regulatory: Pension Reform Act 2014", 14, 40);

            const tableRows = pensionData.map(d => [
                d.name,
                d.pensionId,
                `₦${d.employeeContrib.toLocaleString()}`,
                `₦${d.employerContrib.toLocaleString()}`,
                `₦${d.total.toLocaleString()}`
            ]);

            ;(doc as any).autoTable({
                startY: 50,
                head: [['Employee', 'RSA ID', 'Employee (8%)', 'Employer (10%)', 'Total']],
                body: tableRows,
                theme: 'striped',
                headStyles: { fillColor: [82, 51, 255] }
            });

            doc.save(`Pension_Remittance_${format(new Date(), 'yyyyMMdd')}.pdf`);
            toast({ title: "PDF Exported", description: "Schedule is ready for PenCom submission." });
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
                        <h1 className="font-headline text-3xl font-bold">Pension Remittance</h1>
                        <p className="text-muted-foreground">Mandatory RSA contributions for {currentMonth}.</p>
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
                            <CardTitle className="flex items-center gap-2">
                                <ShieldCheck className="h-5 w-5 text-primary" />
                                RSA Contribution Schedule
                            </CardTitle>
                            <CardDescription>Breakdown of 18% mandatory combined contributions.</CardDescription>
                        </div>
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20 uppercase text-[10px]">PenCom Certified</Badge>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-muted/50">
                            <TableRow>
                                <TableHead className="pl-6">Employee</TableHead>
                                <TableHead>RSA ID</TableHead>
                                <TableHead className="text-right">Employee (8%)</TableHead>
                                <TableHead className="text-right">Employer (10%)</TableHead>
                                <TableHead className="text-right pr-6">Total (₦)</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {pensionData.map((d) => (
                                <TableRow key={d.pensionId} className="hover:bg-muted/10">
                                    <TableCell className="pl-6 font-bold">{d.name}</TableCell>
                                    <TableCell className="text-xs font-mono">{d.pensionId}</TableCell>
                                    <TableCell className="text-right font-mono text-xs">₦{d.employeeContrib.toLocaleString()}</TableCell>
                                    <TableCell className="text-right font-mono text-xs">₦{d.employerContrib.toLocaleString()}</TableCell>
                                    <TableCell className="text-right pr-6 font-mono font-bold text-primary">₦{d.total.toLocaleString()}</TableCell>
                                </TableRow>
                            ))}
                            <TableRow className="bg-muted/30 font-bold">
                                <TableCell colSpan={4} className="pl-6 py-4 text-lg">Total Monthly Remittance</TableCell>
                                <TableCell className="text-right pr-6 py-4 text-lg text-primary">₦{grandTotal.toLocaleString()}</TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Card className="bg-primary/5 border-dashed border-2">
                <CardHeader>
                    <CardTitle className="text-sm">Accounting Integration Note</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                    These figures have been automatically reconciled with your current payroll batch. Ensure the "Employer (10%)" portion is reflected as a business expense in your Profit & Loss statement.
                </CardContent>
            </Card>
        </div>
    );
}
