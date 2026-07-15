"use client";

import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { 
    Settings, 
    Plus, 
    ArrowLeft, 
    ShieldCheck, 
    Landmark, 
    Calculator, 
    CheckCircle2, 
    Info,
    Trash2,
    PlusCircle,
    Edit2
} from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogClose,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";
import { salaryComponents as initialComponents } from "@/lib/data";
import type { SalaryComponent } from "@/lib/data";
import { cn } from "@/lib/utils";

export default function PayrollConfigPage() {
    const { toast } = useToast();
    const [components, setComponents] = React.useState<SalaryComponent[]>(initialComponents);
    const [statutorySettings, setStatutorySettings] = React.useState({
        paye: true,
        pension: true,
    });

    // Add Component Form State
    const [isAddOpen, setIsAddOpen] = React.useState(false);
    const [newComp, setNewComp] = React.useState<Partial<SalaryComponent>>({
        name: "",
        type: "Earning",
        calculationType: "Percentage",
        value: 0,
        isStatutory: false
    });

    // Edit Component Form State
    const [isEditOpen, setIsEditOpen] = React.useState(false);
    const [editingComp, setEditingComp] = React.useState<SalaryComponent | null>(null);
    const [editFormData, setEditFormData] = React.useState<Partial<SalaryComponent>>({});

    const handleAddComponent = () => {
        if (!newComp.name) {
            toast({ variant: "destructive", title: "Missing Name", description: "Please enter a component name." });
            return;
        }

        const component: SalaryComponent = {
            id: `comp-${Date.now()}`,
            name: newComp.name,
            type: newComp.type as any,
            calculationType: newComp.calculationType as any,
            value: newComp.value || 0,
            isStatutory: !!newComp.isStatutory
        };

        setComponents([...components, component]);
        setNewComp({ name: "", type: "Earning", calculationType: "Percentage", value: 0, isStatutory: false });
        setIsAddOpen(false);
        toast({ title: "Component Added", description: `${component.name} is now part of the salary structure.` });
    };

    const handleOpenEdit = (comp: SalaryComponent) => {
        setEditingComp(comp);
        setEditFormData(comp);
        setIsEditOpen(true);
    };

    const handleUpdateComponent = () => {
        if (!editingComp || !editFormData.name) return;

        const updated = components.map(c => 
            c.id === editingComp.id ? { ...c, ...editFormData } as SalaryComponent : c
        );

        setComponents(updated);
        setIsEditOpen(false);
        setEditingComp(null);
        toast({ title: "Component Updated", description: "Changes saved to the salary structure." });
    };

    const handleDeleteComponent = (id: string) => {
        setComponents(components.filter(c => c.id !== id));
        toast({ title: "Component Removed", description: "The item has been removed from payroll rules." });
    };

    const handleSaveAll = () => {
        toast({ 
            title: "Configuration Secured", 
            description: "Global salary components and statutory rules have been saved to the master ledger." 
        });
    };

    return (
        <div className="flex flex-col gap-6 pb-12">
            <div className="flex items-center gap-4">
                <Button asChild variant="ghost" size="icon" className="rounded-full">
                    <Link href="/hr/payroll"><ArrowLeft className="h-4 w-4" /></Link>
                </Button>
                <div>
                    <h1 className="font-headline text-3xl font-bold">Payroll Configuration</h1>
                    <p className="text-muted-foreground">Define your company's salary structure and regulatory rules.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle>Salary Components</CardTitle>
                                <CardDescription>Earnings and deductions that make up the monthly pay.</CardDescription>
                            </div>
                            <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                                <DialogTrigger asChild>
                                    <Button size="sm" variant="outline"><Plus className="mr-2 h-4 w-4" /> New Component</Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle>Add Salary Component</DialogTitle>
                                        <DialogDescription>Create a new rule for earnings or deductions.</DialogDescription>
                                    </DialogHeader>
                                    <div className="space-y-4 py-4">
                                        <div className="space-y-2">
                                            <Label>Component Name</Label>
                                            <Input 
                                                placeholder="e.g. Utility Allowance" 
                                                value={newComp.name} 
                                                onChange={(e) => setNewComp({...newComp, name: e.target.value})} 
                                            />
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Label>Type</Label>
                                                <Select value={newComp.type} onValueChange={(v) => setNewComp({...newComp, type: v as any})}>
                                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="Earning">Earning</SelectItem>
                                                        <SelectItem value="Deduction">Deduction</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Statutory?</Label>
                                                <div className="flex items-center space-x-2 pt-2">
                                                    <Switch 
                                                        checked={newComp.isStatutory} 
                                                        onCheckedChange={(v) => setNewComp({...newComp, isStatutory: v})} 
                                                    />
                                                    <span className="text-xs text-muted-foreground">Is regulated?</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Label>Calculation</Label>
                                                <Select value={newComp.calculationType} onValueChange={(v) => setNewComp({...newComp, calculationType: v as any})}>
                                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="Fixed">Fixed Amount</SelectItem>
                                                        <SelectItem value="Percentage">Percentage (%)</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Value</Label>
                                                <Input 
                                                    type="number" 
                                                    placeholder="0" 
                                                    value={newComp.value} 
                                                    onChange={(e) => setNewComp({...newComp, value: parseFloat(e.target.value) || 0})} 
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <DialogFooter>
                                        <Button className="w-full" onClick={handleAddComponent}>Record Component</Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {components.map((c) => (
                                <div key={c.id} className="flex items-center justify-between p-4 rounded-xl border bg-muted/20 group hover:bg-muted/30 transition-colors">
                                    <div className="flex items-center gap-4">
                                        <div className={cn(
                                            "h-10 w-10 rounded-full flex items-center justify-center font-bold",
                                            c.type === 'Earning' ? "bg-emerald-500/10 text-emerald-700" : "bg-red-500/10 text-red-700"
                                        )}>
                                            {c.type === 'Earning' ? '+' : '-'}
                                        </div>
                                        <div>
                                            <p className="font-bold text-sm">{c.name}</p>
                                            <div className="flex gap-2 mt-1">
                                                <Badge variant="secondary" className="text-[9px] uppercase">{c.calculationType}</Badge>
                                                {c.isStatutory && <Badge className="text-[9px] uppercase bg-primary/10 text-primary">Statutory</Badge>}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="text-right mr-2">
                                            <p className="font-bold text-sm">{c.value}{c.calculationType === 'Percentage' ? '%' : ' Fixed'}</p>
                                            <p className="text-[10px] text-muted-foreground">Effective Date: Jan 2024</p>
                                        </div>
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Button 
                                                variant="ghost" 
                                                size="icon" 
                                                className="h-8 w-8 text-muted-foreground hover:text-primary"
                                                onClick={() => handleOpenEdit(c)}
                                            >
                                                <Edit2 className="h-4 w-4" />
                                            </Button>
                                            <Button 
                                                variant="ghost" 
                                                size="icon" 
                                                className="h-8 w-8 text-destructive hover:bg-destructive/10"
                                                onClick={() => handleDeleteComponent(c.id)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </CardContent>
                    </Card>

                    <Card className="border-primary/20 bg-primary/5">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <ShieldCheck className="h-5 w-5 text-primary" />
                                Statutory Compliance (Nigeria)
                            </CardTitle>
                            <CardDescription>Rules for PAYE, Pension, and NHF remittances.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <Label className="text-base font-bold">Auto-calculate PAYE</Label>
                                    <p className="text-xs text-muted-foreground">Uses the consolidated relief allowance table (FIRS/LIRS).</p>
                                </div>
                                <Switch 
                                    checked={statutorySettings.paye} 
                                    onCheckedChange={(v) => setStatutorySettings({...statutorySettings, paye: v})} 
                                />
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <Label className="text-base font-bold">Pension Contribution (8% / 10%)</Label>
                                    <p className="text-xs text-muted-foreground">Complies with the Pension Reform Act of 2014.</p>
                                </div>
                                <Switch 
                                    checked={statutorySettings.pension} 
                                    onCheckedChange={(v) => setStatutorySettings({...statutorySettings, pension: v})} 
                                />
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <div className="space-y-6">
                    <Card className="bg-muted/50 border-dashed border-2">
                        <CardHeader>
                            <CardTitle className="text-sm font-bold flex items-center gap-2">
                                <Info className="h-4 w-4 text-primary" />
                                Pro-ration Rules
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="text-xs text-muted-foreground space-y-4">
                            <p>Current rule: Salaries for new hires or exits are calculated based on <strong>Calendar Days</strong> in the month.</p>
                            <Button variant="link" className="p-0 h-auto text-primary" onClick={() => toast({ title: "Rule Logic Updated", description: "Pro-ration is now set to working days only." })}>Modify Calculation Logic →</Button>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-sm font-bold flex items-center gap-2">
                                <Landmark className="h-4 w-4 text-primary" />
                                Payment Gateway
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="p-3 rounded-lg border bg-card text-xs font-medium">
                                <p>Bank: Sterling Bank API</p>
                                <p className="text-muted-foreground mt-1">Status: <span className="text-emerald-600 font-bold">CONNECTED</span></p>
                            </div>
                            <Button variant="outline" size="sm" className="w-full" onClick={() => toast({ title: "Refreshing Gateway", description: "Verifying secure connection to bank API..." })}>Re-verify Bank Linking</Button>
                        </CardContent>
                    </Card>
                    <Button onClick={handleSaveAll} className="w-full h-12 rounded-xl shadow-lg shadow-primary/20">
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        Save All Changes
                    </Button>
                </div>
            </div>

            {/* Edit Component Dialog */}
            <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Salary Component</DialogTitle>
                        <DialogDescription>Modify the existing rule for {editingComp?.name}.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Component Name</Label>
                            <Input 
                                placeholder="e.g. Utility Allowance" 
                                value={editFormData.name} 
                                onChange={(e) => setEditFormData({...editFormData, name: e.target.value})} 
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Type</Label>
                                <Select value={editFormData.type} onValueChange={(v) => setEditFormData({...editFormData, type: v as any})}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Earning">Earning</SelectItem>
                                        <SelectItem value="Deduction">Deduction</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Statutory?</Label>
                                <div className="flex items-center space-x-2 pt-2">
                                    <Switch 
                                        checked={editFormData.isStatutory} 
                                        onCheckedChange={(v) => setEditFormData({...editFormData, isStatutory: v})} 
                                    />
                                    <span className="text-xs text-muted-foreground">Is regulated?</span>
                                </div>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Calculation</Label>
                                <Select value={editFormData.calculationType} onValueChange={(v) => setEditFormData({...editFormData, calculationType: v as any})}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Fixed">Fixed Amount</SelectItem>
                                        <SelectItem value="Percentage">Percentage (%)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Value</Label>
                                <Input 
                                    type="number" 
                                    placeholder="0" 
                                    value={editFormData.value} 
                                    onChange={(e) => setEditFormData({...editFormData, value: parseFloat(e.target.value) || 0})} 
                                />
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsEditOpen(false)}>Cancel</Button>
                        <Button onClick={handleUpdateComponent}>Save Changes</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
