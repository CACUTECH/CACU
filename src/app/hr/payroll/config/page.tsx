
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
    Edit2,
    Building2,
    Globe2,
    Coins
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function PayrollConfigPage() {
    const { toast } = useToast();
    const [components, setComponents] = React.useState<SalaryComponent[]>(initialComponents);
    const [statutorySettings, setStatutorySettings] = React.useState({
        paye: true,
        pension: true,
    });

    const [isAddOpen, setIsAddOpen] = React.useState(false);
    const [newComp, setNewComp] = React.useState<Partial<SalaryComponent>>({
        name: "",
        type: "Earning",
        calculationType: "Percentage",
        value: 0,
        isStatutory: false
    });

    const [isEditOpen, setIsEditOpen] = React.useState(false);
    const [editingComp, setEditingComp] = React.useState<SalaryComponent | null>(null);
    const [editFormData, setEditFormData] = React.useState<Partial<SalaryComponent>>({});

    const handleAddComponent = () => {
        if (!newComp.name) {
            toast({ variant: "destructive", title: "Missing Name" });
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
        toast({ title: "Component Policy Added" });
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
        toast({ title: "Component Policy Updated" });
    };

    const handleDeleteComponent = (id: string) => {
        setComponents(components.filter(c => c.id !== id));
        toast({ title: "Component Policy Removed" });
    };

    const handleSaveAll = () => {
        toast({ 
            title: "Global Policies Secured", 
            description: "Payroll rules synchronized across all Legal Entities." 
        });
    };

    return (
        <div className="flex flex-col gap-8 pb-12">
            <div className="flex items-center gap-4">
                <Button asChild variant="ghost" size="icon" className="rounded-full">
                    <Link href="/hr/payroll"><ArrowLeft className="h-4 w-4" /></Link>
                </Button>
                <div>
                    <h1 className="font-headline text-3xl font-bold">Policy Configuration</h1>
                    <p className="text-muted-foreground">Administer multi-entity salary structures and global compliance rules.</p>
                </div>
            </div>

            <Tabs defaultValue="components" className="w-full">
                <TabsList className="bg-primary/5 p-1 border border-primary/10 rounded-2xl h-auto flex flex-wrap lg:w-max">
                    <TabsTrigger value="components" className="rounded-xl px-6 py-2.5 data-[state=active]:bg-primary data-[state=active]:text-white">Earnings & Deductions</TabsTrigger>
                    <TabsTrigger value="compliance" className="rounded-xl px-6 py-2.5 data-[state=active]:bg-primary data-[state=active]:text-white">Compliance Framework</TabsTrigger>
                    <TabsTrigger value="entities" className="rounded-xl px-6 py-2.5 data-[state=active]:bg-primary data-[state=active]:text-white">Legal Entities</TabsTrigger>
                </TabsList>

                <TabsContent value="components" className="mt-8">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <div className="lg:col-span-2 space-y-6">
                            <Card className="shadow-xl shadow-primary/5">
                                <CardHeader className="flex flex-row items-center justify-between border-b bg-muted/20 py-6">
                                    <div>
                                        <CardTitle className="font-headline">Pay Components Master</CardTitle>
                                        <CardDescription>Global library of earnings, deductions, and non-cash benefits.</CardDescription>
                                    </div>
                                    <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                                        <DialogTrigger asChild>
                                            <Button className="rounded-xl shadow-lg shadow-primary/20"><Plus className="mr-2 h-4 w-4" /> New Policy</Button>
                                        </DialogTrigger>
                                        <DialogContent className="sm:max-w-md">
                                            <DialogHeader>
                                                <DialogTitle className="font-headline">Create Pay Policy</DialogTitle>
                                                <DialogDescription>Define a new rule for calculating salary elements.</DialogDescription>
                                            </DialogHeader>
                                            <ComponentForm data={newComp} setData={setNewComp} />
                                            <DialogFooter className="bg-muted/10 p-6 border-t mt-4">
                                                <Button className="w-full" onClick={handleAddComponent}>Add to Master List</Button>
                                            </DialogFooter>
                                        </DialogContent>
                                    </Dialog>
                                </CardHeader>
                                <CardContent className="p-0">
                                    <div className="divide-y divide-border">
                                        {components.map((c) => (
                                            <div key={c.id} className="flex items-center justify-between p-6 group hover:bg-primary/5 transition-all">
                                                <div className="flex items-center gap-4">
                                                    <div className={cn(
                                                        "h-12 w-12 rounded-2xl flex items-center justify-center font-bold text-lg",
                                                        c.type === 'Earning' ? "bg-emerald-500/10 text-emerald-700" : "bg-red-500/10 text-red-700"
                                                    )}>
                                                        {c.type === 'Earning' ? '+' : '-'}
                                                    </div>
                                                    <div>
                                                        <p className="font-bold text-base">{c.name}</p>
                                                        <div className="flex gap-2 mt-1">
                                                            <Badge variant="secondary" className="text-[10px] uppercase font-bold tracking-tighter">{c.calculationType}</Badge>
                                                            {c.isStatutory && <Badge className="text-[10px] uppercase font-bold tracking-tighter bg-primary/10 text-primary">Statutory</Badge>}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-4">
                                                    <div className="text-right">
                                                        <p className="font-bold text-base">{c.value}{c.calculationType === 'Percentage' ? '%' : ' (Fixed)'}</p>
                                                        <p className="text-[10px] text-muted-foreground uppercase font-bold">Base: Gross Pay</p>
                                                    </div>
                                                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl" onClick={() => handleOpenEdit(c)}><Edit2 className="h-4 w-4" /></Button>
                                                        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl text-destructive hover:bg-red-50" onClick={() => handleDeleteComponent(c.id)}><Trash2 className="h-4 w-4" /></Button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        <div className="space-y-6">
                            <Card className="bg-primary text-primary-foreground border-none shadow-2xl shadow-primary/20">
                                <CardHeader>
                                    <CardTitle className="text-lg flex items-center gap-2">
                                        <ShieldCheck className="h-5 w-5" />
                                        Compliance Guard
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4 text-sm text-white/80">
                                    <p>Global policies ensure consistent tax and pension calculation logic across all business units.</p>
                                    <div className="bg-white/10 p-3 rounded-xl">
                                        <p className="text-[10px] font-bold uppercase tracking-widest text-white/60 mb-2">Current Region</p>
                                        <div className="flex items-center gap-2 text-white font-bold">
                                            <Globe2 className="h-4 w-4" /> Nigeria (FIRS/LIRS Compliant)
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                            <Card className="border-dashed border-2 bg-muted/20">
                                <CardHeader><CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Admin Audit Log</CardTitle></CardHeader>
                                <CardContent className="text-[10px] space-y-2">
                                    <div className="flex justify-between"><span>Last modified by:</span><span className="font-bold">Jane Doe</span></div>
                                    <div className="flex justify-between"><span>Date:</span><span className="font-bold">July 20, 2024</span></div>
                                </CardContent>
                            </Card>
                            <Button onClick={handleSaveAll} className="w-full h-14 rounded-2xl shadow-xl shadow-primary/20 text-lg font-bold">
                                <Save className="mr-2 h-5 w-5" />
                                Apply Policy Changes
                            </Button>
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="compliance">
                    <Card className="border-primary/20 shadow-xl shadow-primary/5">
                        <CardHeader>
                            <CardTitle className="font-headline text-2xl flex items-center gap-2">
                                <ShieldCheck className="h-6 w-6 text-primary" />
                                Global Statutory Framework
                            </CardTitle>
                            <CardDescription>Automated calculation rules for taxes, health insurance, and social security.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-8 py-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                                <div className="space-y-6">
                                    <div className="flex items-center justify-between border-b pb-4">
                                        <div className="space-y-0.5">
                                            <Label className="text-base font-bold">PAYE Tax Automation</Label>
                                            <p className="text-xs text-muted-foreground">Uses the consolidated relief allowance table.</p>
                                        </div>
                                        <Switch checked={statutorySettings.paye} onCheckedChange={(v) => setStatutorySettings({...statutorySettings, paye: v})} />
                                    </div>
                                    <div className="flex items-center justify-between border-b pb-4">
                                        <div className="space-y-0.5">
                                            <Label className="text-base font-bold">Employee Pension (8%)</Label>
                                            <p className="text-xs text-muted-foreground">Pension Reform Act of 2014.</p>
                                        </div>
                                        <Switch checked={statutorySettings.pension} onCheckedChange={(v) => setStatutorySettings({...statutorySettings, pension: v})} />
                                    </div>
                                </div>
                                <div className="space-y-6">
                                    <div className="flex items-center justify-between border-b pb-4">
                                        <div className="space-y-0.5">
                                            <Label className="text-base font-bold">National Housing Fund (2.5%)</Label>
                                            <p className="text-xs text-muted-foreground">Mandatory for all Nigerian employees.</p>
                                        </div>
                                        <Switch defaultChecked />
                                    </div>
                                    <div className="flex items-center justify-between border-b pb-4 opacity-50 grayscale">
                                        <div className="space-y-0.5">
                                            <Label className="text-base font-bold">Industrial Training Fund (ITF)</Label>
                                            <p className="text-xs text-muted-foreground">Employer-only contribution module.</p>
                                        </div>
                                        <Badge variant="secondary">Enterprise</Badge>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="entities">
                    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                        <LegalEntityCard name="CACU Tech Ltd (HQ)" reg="RC-12345" type="HQ" />
                        <LegalEntityCard name="CACU Retail Operations" reg="RC-67890" type="Branch" />
                        <Card className="border-dashed border-2 bg-muted/10 flex flex-col items-center justify-center p-8 text-center gap-4 cursor-pointer hover:bg-muted/20 transition-all">
                            <div className="bg-primary/10 p-4 rounded-full"><Building2 className="h-8 w-8 text-primary" /></div>
                            <div>
                                <p className="font-bold">Add Legal Entity</p>
                                <p className="text-xs text-muted-foreground">Configure a new company ID or subsidiary.</p>
                            </div>
                        </Card>
                    </div>
                </TabsContent>
            </Tabs>

            <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="font-headline text-xl">Modify Policy Component</DialogTitle>
                        <DialogDescription>Update calculation logic for existing pay items.</DialogDescription>
                    </DialogHeader>
                    <ComponentForm data={editFormData} setData={setEditFormData} />
                    <DialogFooter className="bg-muted/10 p-6 border-t mt-4">
                        <Button className="w-full" onClick={handleUpdateComponent}>Update Global Rule</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function ComponentForm({ data, setData }: { data: Partial<SalaryComponent>, setData: (d: any) => void }) {
    return (
        <div className="space-y-6 py-4">
            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Policy Name</Label>
                <Input placeholder="e.g. Utility Allowance" value={data.name} onChange={(e) => setData({...data, name: e.target.value})} className="h-12 rounded-xl" />
            </div>
            <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Type</Label>
                    <Select value={data.type} onValueChange={(v) => setData({...data, type: v as any})}>
                        <SelectTrigger className="h-12 rounded-xl"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="Earning">Earning</SelectItem>
                            <SelectItem value="Deduction">Deduction</SelectItem>
                            <SelectItem value="Benefit">Benefit (Non-Cash)</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Regulation</Label>
                    <div className="flex items-center space-x-3 pt-3">
                        <Switch checked={data.isStatutory} onCheckedChange={(v) => setData({...data, isStatutory: v})} />
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-tight">Statutory Requirement</span>
                    </div>
                </div>
            </div>
            <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Logic</Label>
                    <Select value={data.calculationType} onValueChange={(v) => setData({...data, calculationType: v as any})}>
                        <SelectTrigger className="h-12 rounded-xl"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="Fixed">Fixed Amount</SelectItem>
                            <SelectItem value="Percentage">Percentage (%)</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Value</Label>
                    <Input type="number" placeholder="0" value={data.value} onChange={(e) => setData({...data, value: parseFloat(e.target.value) || 0})} className="h-12 rounded-xl font-mono text-lg" />
                </div>
            </div>
        </div>
    );
}

function LegalEntityCard({ name, reg, type }: { name: string, reg: string, type: string }) {
    return (
        <Card className="hover:border-primary transition-all group cursor-pointer shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div className="flex items-center gap-3">
                    <div className="bg-primary/10 p-3 rounded-2xl group-hover:bg-primary group-hover:text-white transition-all">
                        <Building2 className="h-6 w-6" />
                    </div>
                    <div>
                        <CardTitle className="text-base">{name}</CardTitle>
                        <CardDescription>{reg}</CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardFooter className="pt-2">
                <Badge variant="secondary" className="text-[9px] uppercase font-bold tracking-widest">{type}</Badge>
            </CardFooter>
        </Card>
    );
}
