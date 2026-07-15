
"use client";

import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PlusCircle, ArrowLeft, Landmark, History, Clock, FileText, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { initialLoans } from "@/lib/data";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function LoanManagementPage() {
    const { toast } = useToast();
    const [loans, setLoans] = React.useState(initialLoans);

    const totalPortfolio = loans.reduce((acc, l) => acc + l.balance, 0);

    return (
        <div className="flex flex-col gap-6 pb-12">
            <div className="flex items-center gap-4">
                <Button asChild variant="ghost" size="icon" className="rounded-full">
                    <Link href="/hr/payroll"><ArrowLeft className="h-4 w-4" /></Link>
                </Button>
                <div>
                    <h1 className="font-headline text-3xl font-bold">Loans & Advances</h1>
                    <p className="text-muted-foreground">Track employee borrowing and automated payroll repayments.</p>
                </div>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <LoanStatCard title="Active Loan Portfolio" value={`₦${(totalPortfolio / 1000).toFixed(0)}k`} subtext="Outstanding balance" icon={Landmark} />
                <LoanStatCard title="Pending Requests" value="3" subtext="Awaiting review" icon={Clock} />
                <LoanStatCard title="Monthly Recoup" value="₦125k" subtext="Next payroll deduction" icon={History} />
                <LoanStatCard title="Health Status" value="On Track" subtext="No repayment defaults" icon={CheckCircle2} />
            </div>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>Active Staff Loans</CardTitle>
                        <CardDescription>Repayments are automatically subtracted from net pay each month.</CardDescription>
                    </div>
                    <Dialog>
                        <DialogTrigger asChild>
                            <Button size="sm" className="rounded-xl"><PlusCircle className="mr-2 h-4 w-4" /> Issue Loan</Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>New Loan Application</DialogTitle>
                                <DialogDescription>Define loan terms for an employee advance.</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                                <div className="space-y-2">
                                    <Label>Select Employee</Label>
                                    <Select>
                                        <SelectTrigger><SelectValue placeholder="Select staff..." /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="e1">Samuel Okoro</SelectItem>
                                            <SelectItem value="e2">Chioma Nwosu</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Loan Amount (₦)</Label>
                                        <Input type="number" placeholder="500000" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Tenor (Months)</Label>
                                        <Input type="number" placeholder="10" />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label>Purpose</Label>
                                    <Input placeholder="e.g. Salary Advance" />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button className="w-full" onClick={() => toast({ title: "Loan Recorded" })}>Approve & Record</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-muted/50">
                            <TableRow>
                                <TableHead className="pl-6">Employee</TableHead>
                                <TableHead>Loan Purpose</TableHead>
                                <TableHead className="text-right">Original (₦)</TableHead>
                                <TableHead className="text-right">Balance (₦)</TableHead>
                                <TableHead className="text-right">Monthly (₦)</TableHead>
                                <TableHead className="text-right pr-6">Status</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loans.map((l) => (
                                <TableRow key={l.id}>
                                    <TableCell className="pl-6 font-bold">{l.employeeName}</TableCell>
                                    <TableCell className="text-sm">{l.purpose}</TableCell>
                                    <TableCell className="text-right font-mono">₦{l.amount.toLocaleString()}</TableCell>
                                    <TableCell className="text-right font-mono font-bold text-red-600">₦{l.balance.toLocaleString()}</TableCell>
                                    <TableCell className="text-right font-mono">₦{l.monthlyDeduction.toLocaleString()}</TableCell>
                                    <TableCell className="text-right pr-6">
                                        <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20">{l.status}</Badge>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}

function LoanStatCard({ title, value, subtext, icon: Icon }: any) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</CardTitle>
                <div className="bg-primary/10 p-2 rounded-lg"><Icon className="h-4 w-4 text-primary" /></div>
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold font-headline">{value}</div>
                <p className="text-[10px] text-muted-foreground mt-1">{subtext}</p>
            </CardContent>
        </Card>
    );
}
