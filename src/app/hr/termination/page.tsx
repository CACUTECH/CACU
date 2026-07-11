
"use client";

import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { 
    UserX, 
    FileText, 
    Printer, 
    Download, 
    Send, 
    ArrowLeft, 
    AlertCircle, 
    CheckCircle2, 
    Loader2,
    Eye,
    Edit2,
    Save
} from "lucide-react";
import { employees } from "@/lib/data";
import type { Employee } from "@/lib/data";
import { format } from "date-fns";
import Link from "next/link";
import { cn } from "@/lib/utils";

export default function TerminationPage() {
    const { toast } = useToast();
    const [selectedEmployeeId, setSelectedEmployeeId] = React.useState("");
    const [reason, setReason] = React.useState("");
    const [lastDay, setLastDay] = React.useState(format(new Date(), "yyyy-MM-dd"));
    const [isGenerating, setIsGenerating] = React.useState(false);
    const [isExporting, setIsExporting] = React.useState(false);
    const [isEditingDraft, setIsEditingDraft] = React.useState(false);
    const [draftContent, setDraftDraftContent] = React.useState("");
    const [finalized, setFinalized] = React.useState(false);

    const selectedEmployee = employees.find(e => e.id === selectedEmployeeId);

    const generateDraft = () => {
        if (!selectedEmployeeId || !reason) {
            toast({
                variant: "destructive",
                title: "Missing Information",
                description: "Please select an employee and provide a reason for termination."
            });
            return;
        }

        setIsGenerating(true);
        setTimeout(() => {
            const content = `Date: ${format(new Date(), "PPP")}

Dear ${selectedEmployee?.name},

This letter is to formally notify you that your employment with CACU Technologies Limited is being terminated, effective ${format(new Date(lastDay), "PPP")}.

Reason for termination:
${reason}

Regarding your final compensation, our payroll department will process your remaining salary, including any accrued vacation time, by your final day of work. Please return all company property, including keys, badges, and equipment, on or before your last day.

We wish you the best in your future endeavors.

Sincerely,
HR Management
CACU Technologies Limited`;
            
            setDraftDraftContent(content);
            setIsGenerating(false);
            setFinalized(true);
            toast({ title: "Draft Created", description: "Termination notice has been generated." });
        }, 1000);
    };

    const handleExportPdf = async () => {
        setIsExporting(true);
        try {
            const { default: jsPDF } = await import('jspdf');
            const doc = new jsPDF();
            
            doc.setFontSize(16);
            doc.text("Employee Termination Notice", 105, 20, { align: 'center' });
            
            doc.setFontSize(11);
            const splitText = doc.splitTextToSize(draftContent, 180);
            doc.text(splitText, 15, 40);
            
            doc.save(`Termination_Notice_${selectedEmployee?.name.replace(' ', '_')}.pdf`);
            toast({ title: "PDF Exported", description: "Notice is ready for printing/filing." });
        } catch (error) {
            toast({ variant: "destructive", title: "Export Failed" });
        } finally {
            setIsExporting(false);
        }
    };

    const handlePrint = () => {
        const printWindow = window.open('', '_blank');
        if (printWindow) {
            printWindow.document.write(`<pre style="font-family: sans-serif; padding: 40px; white-space: pre-wrap;">${draftContent}</pre>`);
            printWindow.document.close();
            printWindow.print();
        }
    };

    const handleEmail = () => {
        toast({
            title: "Sharing Notice",
            description: `Drafting email to ${selectedEmployee?.email}...`,
            action: <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        });
        // In a real app, this would open a mailer or send via server
    };

    return (
        <div className="flex flex-col gap-6 pb-12">
            <div className="flex items-center gap-4">
                <Button asChild variant="ghost" size="icon" className="rounded-full">
                    <Link href="/hr"><ArrowLeft className="h-4 w-4" /></Link>
                </Button>
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">Employee Exits & Termination</h1>
                    <p className="text-muted-foreground mt-1">Manage professional offboarding and compliance documentation.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Form Section */}
                <div className="lg:col-span-5 space-y-6">
                    <Card className="border-primary/10">
                        <CardHeader>
                            <CardTitle className="text-lg flex items-center gap-2">
                                <UserX className="h-5 w-5 text-primary" />
                                Record Exit Details
                            </CardTitle>
                            <CardDescription>Document the reason and timeline for the employee's departure.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label>Select Employee</Label>
                                <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Search team member..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {employees.filter(e => e.status !== 'Terminated').map(e => (
                                            <SelectItem key={e.id} value={e.id}>{e.name} ({e.role})</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label>Termination Effective Date</Label>
                                <Input type="date" value={lastDay} onChange={(e) => setLastDay(e.target.value)} />
                            </div>

                            <div className="space-y-2">
                                <Label>Brief Description of Reason</Label>
                                <Textarea 
                                    placeholder="Provide context for the termination (e.g., policy violation, performance issues, redundancy)..." 
                                    className="min-h-[120px]"
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                />
                            </div>
                        </CardContent>
                        <CardFooter className="bg-muted/30 border-t pt-6">
                            <Button className="w-full" onClick={generateDraft} disabled={isGenerating}>
                                {isGenerating ? (
                                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Preparing Draft...</>
                                ) : (
                                    <><FileText className="mr-2 h-4 w-4" /> Create Termination Draft</>
                                )}
                            </Button>
                        </CardFooter>
                    </Card>

                    <Card className="bg-amber-50 border-amber-200">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-bold text-amber-800 flex items-center gap-2">
                                <AlertCircle className="h-4 w-4" />
                                Compliance Reminder
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="text-xs text-amber-700 leading-relaxed">
                            Ensure termination follows the guidelines set in the employee's contract and the Nigerian Labour Act. Double-check all recorded reasons to avoid potential litigation.
                        </CardContent>
                    </Card>
                </div>

                {/* Draft Preview Section */}
                <div className="lg:col-span-7">
                    {finalized ? (
                        <Card className="border-primary shadow-xl shadow-primary/5">
                            <CardHeader className="border-b bg-primary/5 flex flex-row items-center justify-between">
                                <div>
                                    <CardTitle className="text-lg">Termination Notice Draft</CardTitle>
                                    <CardDescription>Review and finalize the document below.</CardDescription>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button 
                                        variant="outline" 
                                        size="sm" 
                                        onClick={() => setIsEditingDraft(!isEditingDraft)}
                                    >
                                        {isEditingDraft ? <><Save className="h-4 w-4 mr-2" /> Finish</> : <><Edit2 className="h-4 w-4 mr-2" /> Edit</>}
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent className="p-0">
                                <div className="p-8 bg-white min-h-[500px]">
                                    {isEditingDraft ? (
                                        <Textarea 
                                            value={draftContent} 
                                            onChange={(e) => setDraftDraftContent(e.target.value)}
                                            className="min-h-[440px] font-mono text-sm leading-relaxed border-none focus-visible:ring-0 p-0 shadow-none resize-none"
                                        />
                                    ) : (
                                        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-800">
                                            {draftContent}
                                        </pre>
                                    )}
                                </div>
                            </CardContent>
                            <CardFooter className="bg-muted/30 border-t p-6 gap-3">
                                <Button variant="outline" className="flex-1" onClick={handlePrint}>
                                    <Printer className="mr-2 h-4 w-4" /> Print Notice
                                </Button>
                                <Button variant="outline" className="flex-1" onClick={handleExportPdf} disabled={isExporting}>
                                    {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                                    Export PDF
                                </Button>
                                <Button className="flex-1" onClick={handleEmail}>
                                    <Send className="mr-2 h-4 w-4" /> Send Email
                                </Button>
                            </CardFooter>
                        </Card>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-center p-12 border-2 border-dashed rounded-xl bg-muted/20 opacity-50">
                            <FileText className="h-16 w-16 text-muted-foreground mb-4" />
                            <h3 className="text-xl font-bold font-headline">No Draft Generated</h3>
                            <p className="text-sm text-muted-foreground max-w-xs mt-2">
                                Fill in the employee details and reason on the left to start a termination document.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
