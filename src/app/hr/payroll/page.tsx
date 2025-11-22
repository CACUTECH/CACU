
"use client";

import * as React from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileDown, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

function RunPayrollDialog({ onConfirm }: { onConfirm: () => void }) {
    const [isOpen, setIsOpen] = React.useState(false);

    const handleConfirm = () => {
        onConfirm();
        setIsOpen(false);
    }

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button>
                    <FileDown className="mr-2 h-4 w-4" />
                    Run Payroll
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Confirm Payroll Run</DialogTitle>
                    <DialogDescription>
                        You are about to run payroll for July 2024. Please review the details below before confirming.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Total Gross Pay</span>
                        <span className="font-bold font-headline">₦1,550,000</span>
                    </div>
                     <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Total Deductions</span>
                        <span className="font-bold font-headline">₦232,500</span>
                    </div>
                     <div className="flex justify-between items-center text-lg">
                        <span className="text-muted-foreground">Total Net Pay</span>
                        <span className="font-bold font-headline">₦1,317,500</span>
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button variant="secondary">Cancel</Button>
                    </DialogClose>
                    <Button onClick={handleConfirm}>
                        Confirm & Run Payroll
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}


export default function PayrollPage() {
    const { toast } = useToast();
    const [isLoading, setIsLoading] = React.useState(false);

    const handleRunPayroll = () => {
        setIsLoading(true);
        toast({
            title: "Processing Payroll...",
            description: "This may take a few moments.",
        });

        setTimeout(() => {
            setIsLoading(false);
            toast({
                title: "Payroll Complete!",
                description: "July 2024 payroll has been processed successfully.",
            });
        }, 2000);
    }

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="font-headline text-3xl font-bold">Payroll</h1>
                    <p className="text-muted-foreground">
                        Manage and process your company's payroll.
                    </p>
                </div>
                <RunPayrollDialog onConfirm={handleRunPayroll} />
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Payroll Summary - July 2024</CardTitle>
                    <CardDescription>
                        Summary of the current payroll period.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid gap-4 md:grid-cols-3">
                         <div className="rounded-xl border bg-card text-card-foreground shadow p-6">
                            <h3 className="text-sm font-medium text-muted-foreground">Total Gross Pay</h3>
                            <p className="text-2xl font-bold font-headline">₦1,550,000</p>
                         </div>
                         <div className="rounded-xl border bg-card text-card-foreground shadow p-6">
                            <h3 className="text-sm font-medium text-muted-foreground">Total Deductions</h3>
                            <p className="text-2xl font-bold font-headline">₦232,500</p>
                         </div>
                         <div className="rounded-xl border bg-card text-card-foreground shadow p-6">
                            <h3 className="text-sm font-medium text-muted-foreground">Total Net Pay</h3>
                            <p className="text-2xl font-bold font-headline">₦1,317,500</p>
                         </div>
                    </div>
                </CardContent>
            </Card>
             <Card>
                <CardHeader>
                    <CardTitle>Payroll History</CardTitle>
                </CardHeader>
                <CardContent>
                     {isLoading ? (
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin" />
                            <span>Processing payroll...</span>
                        </div>
                    ) : (
                        <p className="text-muted-foreground">A list of past payroll runs will be displayed here.</p>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
