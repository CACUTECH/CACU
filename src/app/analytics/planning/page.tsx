
"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Progress } from "@/components/ui/progress"
import { PlusCircle, Download, FileText, Target, Wallet, TrendingUp } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const initialBudgets = [
    { category: "Operations", allocated: 500000, spent: 320000 },
    { category: "Marketing", allocated: 200000, spent: 180000 },
    { category: "Payroll", allocated: 1500000, spent: 1500000 },
    { category: "Technology", allocated: 300000, spent: 45000 },
    { category: "Legal & Admin", allocated: 100000, spent: 12000 },
]

export default function PlanningPage() {
    const [budgets] = React.useState(initialBudgets)

    const totalAllocated = budgets.reduce((acc, curr) => acc + curr.allocated, 0)
    const totalSpent = budgets.reduce((acc, curr) => acc + curr.spent, 0)
    const overallProgress = (totalSpent / totalAllocated) * 100

    return (
        <div className="flex flex-col gap-8 pb-12">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">Planning & Budgeting</h1>
                    <p className="text-muted-foreground mt-1">
                        Create detailed budgets and financial plans to guide your business strategy.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm">
                        <Download className="mr-2 h-4 w-4" />
                        Export Plan
                    </Button>
                    <Dialog>
                        <DialogTrigger asChild>
                            <Button size="sm">
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Add Budget Item
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Add Budget Category</DialogTitle>
                                <DialogDescription>Define a new spending limit for your business units.</DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="category" className="text-right">Category</Label>
                                    <Input id="category" placeholder="e.g. R&D" className="col-span-3" />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="limit" className="text-right">Limit (₦)</Label>
                                    <Input id="limit" type="number" placeholder="50000" className="col-span-3" />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="period" className="text-right">Period</Label>
                                    <Select defaultValue="monthly">
                                        <SelectTrigger className="col-span-3">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="monthly">Monthly</SelectItem>
                                            <SelectItem value="quarterly">Quarterly</SelectItem>
                                            <SelectItem value="yearly">Yearly</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button type="submit">Create Item</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                <Card className="bg-primary text-primary-foreground border-none shadow-xl shadow-primary/20">
                    <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                        <CardTitle className="text-sm font-medium">Total Annual Budget</CardTitle>
                        <Wallet className="h-4 w-4 opacity-70" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold font-headline">₦{totalAllocated.toLocaleString()}</div>
                        <p className="text-xs opacity-70 mt-1">+15% from last fiscal year</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                        <CardTitle className="text-sm font-medium">Actual Spending</CardTitle>
                        <TrendingUp className="h-4 w-4 text-primary" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold font-headline">₦{totalSpent.toLocaleString()}</div>
                        <div className="flex items-center gap-2 mt-1">
                            <Progress value={overallProgress} className="h-1.5 flex-1" />
                            <span className="text-xs font-medium">{Math.round(overallProgress)}% used</span>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                        <CardTitle className="text-sm font-medium">Strategic Reserve</CardTitle>
                        <Target className="h-4 w-4 text-primary" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold font-headline">₦{(totalAllocated - totalSpent).toLocaleString()}</div>
                        <p className="text-xs text-muted-foreground mt-1 text-green-600 font-medium">Available for allocation</p>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="font-headline">Departmental Budgets</CardTitle>
                    <CardDescription>Detailed breakdown of your financial allocations across business units.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Category</TableHead>
                                    <TableHead className="text-right">Allocated</TableHead>
                                    <TableHead className="text-right">Spent</TableHead>
                                    <TableHead>Utilization</TableHead>
                                    <TableHead className="text-right">Remaining</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {budgets.map((item) => {
                                    const utilization = (item.spent / item.allocated) * 100
                                    const remaining = item.allocated - item.spent
                                    return (
                                        <TableRow key={item.category}>
                                            <TableCell className="font-medium">{item.category}</TableCell>
                                            <TableCell className="text-right font-mono">₦{item.allocated.toLocaleString()}</TableCell>
                                            <TableCell className="text-right font-mono">₦{item.spent.toLocaleString()}</TableCell>
                                            <TableCell className="min-w-[150px]">
                                                <div className="flex items-center gap-2">
                                                    <Progress value={utilization} className="h-2 flex-1" />
                                                    <span className="text-xs font-medium">{Math.round(utilization)}%</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right font-mono">₦{remaining.toLocaleString()}</TableCell>
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <FileText className="h-5 w-5 text-primary" />
                            Financial Objectives
                        </CardTitle>
                        <CardDescription>Track your progress against key business targets.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="font-medium">Reduce Overhead by 10%</span>
                                <span className="text-muted-foreground">Q3 Target</span>
                            </div>
                            <Progress value={65} className="h-2" />
                        </div>
                        <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="font-medium">Grow Marketing Reach by 25%</span>
                                <span className="text-muted-foreground">In Progress</span>
                            </div>
                            <Progress value={40} className="h-2" />
                        </div>
                         <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="font-medium">Maintain ₦1M Cash Reserve</span>
                                <span className="text-green-600 font-bold">Achieved</span>
                            </div>
                            <Progress value={100} className="h-2" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="bg-muted/50 border-dashed border-2">
                    <CardHeader>
                        <CardTitle className="text-lg">Budgeting Strategy Tips</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4 text-sm text-muted-foreground">
                        <p>• <strong>Flexibility:</strong> Review your budget monthly to adjust for unexpected market shifts in Nigeria.</p>
                        <p>• <strong>Liquidity:</strong> Ensure at least 15% of your allocation goes into a reserve fund for liquidity.</p>
                        <p>• <strong>Reporting:</strong> Use the &quot;Export Plan&quot; feature to share financial roadmaps with stakeholders or lenders.</p>
                        <Button variant="link" className="p-0 h-auto text-primary">Read full strategy guide →</Button>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
