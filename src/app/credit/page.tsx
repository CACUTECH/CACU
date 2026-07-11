"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
    CheckCircle, 
    Upload, 
    Handshake, 
    ExternalLink, 
    ShieldCheck, 
    TrendingUp, 
    Clock, 
    FileText, 
    PlusCircle,
    Landmark,
    ArrowRight,
    Info,
    CheckCircle2,
    Loader2
} from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogClose,
} from "@/components/ui/dialog"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

// Sample Data
const preQualifiedOffers = [
    { id: 'off-1', lender: 'Sterling Bank', amount: 5000000, rate: '14%', tenor: '24 Months', type: 'SME Loan' },
    { id: 'off-2', lender: 'Access Bank', amount: 2500000, rate: '12%', tenor: '12 Months', type: 'Working Capital' },
    { id: 'off-3', lender: 'Paga Business', amount: 500000, rate: '18%', tenor: '6 Months', type: 'Quick Credit' },
]

const recentApplications = [
    { id: 'APP-9231', amount: 3000000, date: '2024-07-15', status: 'Under Review', lender: 'Zenith Bank' },
    { id: 'APP-8842', amount: 1500000, date: '2024-06-10', status: 'Approved', lender: 'Sterling Bank' },
]

const lenders = [
    { name: 'Bank of Industry (BOI)', focus: 'Manufacturing & Production', minAmount: '₦5M', icon: Landmark },
    { name: 'LSETF', focus: 'Lagos-based MSMEs', minAmount: '₦500k', icon: ShieldCheck },
    { name: 'Lidya', focus: 'Quick Working Capital', minAmount: '₦100k', icon: TrendingUp },
]

export default function CreditPage() {
    const { toast } = useToast()
    const [isApplying, setIsApplying] = React.useState(false)
    const [offers] = React.useState(preQualifiedOffers)
    const [applications, setApplications] = React.useState(recentApplications)

    const handleNewApplication = (e: React.FormEvent) => {
        e.preventDefault()
        setIsApplying(true)
        
        setTimeout(() => {
            const newApp = {
                id: `APP-${Math.floor(1000 + Math.random() * 9000)}`,
                amount: 1000000,
                date: new Date().toISOString().split('T')[0],
                status: 'Pending',
                lender: 'TBD'
            }
            setApplications([newApp, ...applications])
            setIsApplying(false)
            toast({
                title: "Application Submitted",
                description: "Your request has been sent to the underwriting team for review.",
            })
        }, 1500)
    }

    return (
        <div className="flex flex-col gap-8 pb-12">
            <div className="text-center max-w-2xl mx-auto space-y-2">
                <h1 className="font-headline text-3xl sm:text-4xl font-bold tracking-tight">Credit Access & Offers</h1>
                <p className="text-lg text-muted-foreground italic">
                    Unlock capital to scale your business. We match your financial data with Nigeria's leading lenders.
                </p>
            </div>

            <div className="grid gap-8 md:grid-cols-1 lg:grid-cols-3">
                {/* Offers Card */}
                <Card className="flex flex-col border-primary/10 shadow-xl shadow-primary/5 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-3">
                        <Badge className="bg-emerald-500 hover:bg-emerald-600 animate-pulse">3 New Offers</Badge>
                    </div>
                    <CardHeader>
                        <div className="flex justify-center mb-4">
                            <div className="bg-primary/10 p-4 rounded-2xl group-hover:scale-110 transition-transform">
                                <CheckCircle className="h-10 w-10 text-primary" />
                            </div>
                        </div>
                        <CardTitle className="text-center font-headline">Pre-Qualified Offers</CardTitle>
                        <CardDescription className="text-center">
                            Instant credit lines based on your transaction history and account turnover.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow flex flex-col justify-end mt-4">
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button className="w-full rounded-xl h-12 text-lg font-bold shadow-lg shadow-primary/20">
                                    View My Offers
                                    <ExternalLink className="ml-2 h-4 w-4" />
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-3xl">
                                <DialogHeader>
                                    <DialogTitle className="text-2xl font-headline">Credit Opportunities</DialogTitle>
                                    <DialogDescription>Select an offer to begin the fast-track disbursement process.</DialogDescription>
                                </DialogHeader>
                                <div className="rounded-xl border overflow-hidden mt-4">
                                    <Table>
                                        <TableHeader className="bg-muted/50">
                                            <TableRow>
                                                <TableHead>Lender</TableHead>
                                                <TableHead>Loan Type</TableHead>
                                                <TableHead className="text-right">Max Amount</TableHead>
                                                <TableHead className="text-center">Rate</TableHead>
                                                <TableHead></TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {offers.map(offer => (
                                                <TableRow key={offer.id}>
                                                    <TableCell className="font-bold">{offer.lender}</TableCell>
                                                    <TableCell><Badge variant="outline" className="text-[10px] uppercase">{offer.type}</Badge></TableCell>
                                                    <TableCell className="text-right font-mono font-bold text-primary">₦{offer.amount.toLocaleString()}</TableCell>
                                                    <TableCell className="text-center font-medium text-emerald-600">{offer.rate}</TableCell>
                                                    <TableCell className="text-right">
                                                        <Button size="sm" variant="ghost" className="text-primary hover:bg-primary/5">Apply <ArrowRight className="ml-1 h-3 w-3" /></Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                                <div className="mt-4 p-4 bg-primary/5 rounded-xl border border-dashed border-primary/20 flex items-start gap-3">
                                    <Info className="h-5 w-5 text-primary shrink-0" />
                                    <p className="text-xs text-muted-foreground">
                                        These offers are valid for 7 days. Final approval is subject to secondary document verification by the lending institution.
                                    </p>
                                </div>
                            </DialogContent>
                        </Dialog>
                    </CardContent>
                </Card>

                {/* Applications Card */}
                <Card className="flex flex-col border-primary/10 shadow-xl shadow-primary/5 group">
                    <CardHeader>
                        <div className="flex justify-center mb-4">
                            <div className="bg-primary/10 p-4 rounded-2xl group-hover:scale-110 transition-transform">
                                <Upload className="h-10 w-10 text-primary" />
                            </div>
                        </div>
                        <CardTitle className="text-center font-headline">Loan Application Portal</CardTitle>
                        <CardDescription className="text-center">
                            Track your active financing requests and upload required regulatory documents.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow flex flex-col justify-end mt-4">
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button variant="outline" className="w-full rounded-xl h-12 text-lg font-bold border-primary/20 text-primary hover:bg-primary/5">
                                    Start New Application
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-md">
                                <DialogHeader>
                                    <DialogTitle className="font-headline text-2xl">New Loan Request</DialogTitle>
                                    <DialogDescription>Specify your funding requirements to begin.</DialogDescription>
                                </DialogHeader>
                                <form onSubmit={handleNewApplication} className="space-y-6 py-4">
                                    <div className="space-y-2">
                                        <Label>Desired Amount (₦)</Label>
                                        <Input type="number" placeholder="e.g. 5,000,000" required />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Loan Purpose</Label>
                                        <Select required>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select purpose" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="inventory">Inventory Purchase</SelectItem>
                                                <SelectItem value="equipment">Equipment Lease</SelectItem>
                                                <SelectItem value="expansion">Business Expansion</SelectItem>
                                                <SelectItem value="payroll">Payroll Support</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Repayment Period</Label>
                                        <Select defaultValue="12">
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="6">6 Months</SelectItem>
                                                <SelectItem value="12">12 Months</SelectItem>
                                                <SelectItem value="24">24 Months</SelectItem>
                                                <SelectItem value="36">36 Months</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <Button type="submit" className="w-full h-12 text-lg font-bold" disabled={isApplying}>
                                        {isApplying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-5 w-5" />}
                                        Submit Request
                                    </Button>
                                </form>
                            </DialogContent>
                        </Dialog>
                    </CardContent>
                    <CardFooter className="pt-0">
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button variant="link" className="w-full text-xs text-muted-foreground uppercase font-bold tracking-widest hover:text-primary">
                                    <Clock className="mr-2 h-3 w-3" /> View Recent Status
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl">
                                <DialogHeader>
                                    <DialogTitle>Recent Applications</DialogTitle>
                                </DialogHeader>
                                <div className="space-y-4 mt-4">
                                    {applications.map(app => (
                                        <div key={app.id} className="flex items-center justify-between p-4 rounded-xl border bg-muted/20">
                                            <div className="space-y-1">
                                                <p className="font-bold text-sm">{app.lender} Application</p>
                                                <p className="text-xs text-muted-foreground">ID: {app.id} • {app.date}</p>
                                            </div>
                                            <div className="text-right space-y-1">
                                                <p className="font-bold">₦{app.amount.toLocaleString()}</p>
                                                <Badge className={cn(
                                                    app.status === 'Approved' ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/10 text-amber-700"
                                                )} variant="secondary">{app.status}</Badge>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </DialogContent>
                        </Dialog>
                    </CardFooter>
                </Card>
                
                {/* Lenders Card */}
                <Card className="flex flex-col border-primary/10 shadow-xl shadow-primary/5 group">
                    <CardHeader>
                        <div className="flex justify-center mb-4">
                             <div className="bg-primary/10 p-4 rounded-2xl group-hover:scale-110 transition-transform">
                                <Handshake className="h-10 w-10 text-primary" />
                            </div>
                        </div>
                        <CardTitle className="text-center font-headline">Recommended Lenders</CardTitle>
                        <CardDescription className="text-center">
                            Discover a curated list of trusted financial partners that match your business sector.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow flex flex-col justify-end mt-4">
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button variant="secondary" className="w-full rounded-xl h-12 text-lg font-bold">
                                    Browse Lenders
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl">
                                <DialogHeader>
                                    <DialogTitle className="text-2xl font-headline">Lending Network</DialogTitle>
                                    <DialogDescription>Connect with institutions that understand your specific industry.</DialogDescription>
                                </DialogHeader>
                                <div className="grid gap-4 mt-6">
                                    {lenders.map((lender, i) => (
                                        <div key={i} className="flex items-center gap-4 p-4 rounded-2xl border bg-card hover:border-primary transition-colors cursor-pointer">
                                            <div className="bg-primary/5 p-3 rounded-xl">
                                                <lender.icon className="h-6 w-6 text-primary" />
                                            </div>
                                            <div className="flex-grow">
                                                <p className="font-bold">{lender.name}</p>
                                                <p className="text-xs text-muted-foreground">{lender.focus}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-tighter">Min. Amount</p>
                                                <p className="font-bold text-primary">{lender.minAmount}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </DialogContent>
                        </Dialog>
                    </CardContent>
                </Card>
            </div>

            {/* Bottom Insight Card */}
            <Card className="bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20 mt-4">
                <CardContent className="p-8 flex flex-col md:flex-row items-center gap-8">
                    <div className="bg-white p-6 rounded-3xl shadow-xl shadow-primary/10">
                        <FileText className="h-12 w-12 text-primary" />
                    </div>
                    <div className="space-y-4 text-center md:text-left">
                        <h3 className="text-2xl font-bold font-headline">Build Your Credit Score</h3>
                        <p className="text-muted-foreground max-w-xl">
                            CACU helps you build a credit-ready profile by automatically generating financial statements 
                            and keeping your records clean. Businesses with consistent transaction logs have a 45% higher 
                            chance of loan approval.
                        </p>
                        <div className="flex flex-wrap justify-center md:justify-start gap-4">
                            <div className="flex items-center gap-2 text-emerald-600 font-bold text-xs uppercase tracking-widest">
                                <CheckCircle2 className="h-4 w-4" /> Bank Statement Ready
                            </div>
                            <div className="flex items-center gap-2 text-emerald-600 font-bold text-xs uppercase tracking-widest">
                                <CheckCircle2 className="h-4 w-4" /> Tax Compliance Logs
                            </div>
                        </div>
                    </div>
                    <div className="flex-shrink-0">
                        <Button variant="outline" className="border-primary/20 text-primary hover:bg-primary/5">
                            Download Audit Pack
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
