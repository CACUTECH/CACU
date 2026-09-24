
"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PlusCircle, Search, MoreHorizontal, Filter, Box, Clock, Loader2, Trash2, Edit2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { createClient } from "@/lib/supabase/client"
import { useSupabaseUser } from "@/hooks/use-supabase-user"
import { useBusiness } from "@/components/business-provider"
import { saveCatalogItemAction, deleteCatalogItemAction } from "./actions"

type CatalogItem = {
    id: string;
    type: 'Product' | 'Service' | 'Package';
    name: string;
    category: string;
    description: string;
    price: number;
    status: string;
    sku?: string;
    quantity?: number;
    reorder_level?: number;
    duration?: number;
    pricing_model?: string;
}

export default function CatalogPage() {
    const { user } = useSupabaseUser();
    const { business } = useBusiness();
    const supabase = createClient();
    const { toast } = useToast();
    
    const [searchTerm, setSearchTerm] = React.useState("")
    const [filter, setFilter] = React.useState<'All' | 'Product' | 'Service'>('All')
    const [items, setItems] = React.useState<CatalogItem[]>([])
    const [loading, setLoading] = React.useState(true)
    const [isAddOpen, setIsAddOpen] = React.useState(false)
    const [isEditOpen, setIsEditOpen] = React.useState(false)
    const [selectedItem, setSelectedItem] = React.useState<CatalogItem | null>(null)

    const [formData, setFormData] = React.useState<Partial<CatalogItem>>({
        type: 'Product',
        name: '',
        category: '',
        price: 0,
        description: '',
        sku: '',
        quantity: 0,
        reorder_level: 5,
        duration: 30,
        pricing_model: 'Fixed'
    })

    const fetchItems = React.useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('catalog_items')
            .select('*')
            .order('name');
        
        if (error) {
            toast({ variant: 'destructive', title: 'Catalog Sync Error', description: error.message });
        } else {
            setItems(data || []);
        }
        setLoading(false);
    }, [supabase, toast]);

    React.useEffect(() => {
        if (user) fetchItems();
    }, [user, fetchItems]);

    const filteredItems = items.filter(item => {
        const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                             (item.category && item.category.toLowerCase().includes(searchTerm.toLowerCase()));
        const matchesFilter = filter === 'All' || item.type === filter;
        return matchesSearch && matchesFilter;
    })

    const handleSave = async () => {
        const result = await saveCatalogItemAction(formData);
        if (result.success) {
            toast({ title: "Catalog Updated" });
            fetchItems();
            setIsAddOpen(false);
            setIsEditOpen(false);
            resetForm();
        } else {
            toast({ variant: "destructive", title: "Save Failed", description: result.error });
        }
    }

    const handleDelete = async (id: string) => {
        const result = await deleteCatalogItemAction(id);
        if (result.success) {
            toast({ title: "Item Removed" });
            fetchItems();
        }
    }

    const resetForm = () => {
        setFormData({
            type: business?.business_type === 'SERVICE' ? 'Service' : 'Product',
            name: '',
            category: '',
            price: 0,
            description: '',
            sku: '',
            quantity: 0,
            reorder_level: 5,
            duration: 30,
            pricing_model: 'Fixed'
        })
    }

    const openEdit = (item: CatalogItem) => {
        setSelectedItem(item)
        setFormData(item)
        setIsEditOpen(true)
    }

    if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

    const pageTitle = business?.business_type === 'SERVICE' ? 'Service Menu' : business?.business_type === 'PRODUCT' ? 'Product Catalog' : 'Business Catalog';

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight text-foreground">{pageTitle}</h1>
                    <p className="text-muted-foreground mt-1">Unified management of your goods and services.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Dialog open={isAddOpen} onOpenChange={(open) => { setIsAddOpen(open); if(open) resetForm(); }}>
                        <DialogTrigger asChild>
                            <Button className="rounded-xl shadow-lg shadow-primary/20">
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Add Item
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-xl">
                            <DialogHeader><DialogTitle>New Catalog Entry</DialogTitle></DialogHeader>
                            <CatalogItemForm data={formData} setData={setFormData} />
                            <DialogFooter>
                                <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                                <Button onClick={handleSave}>Create Entry</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            <Card className="shadow-xl shadow-primary/5 border-primary/10">
                <CardHeader className="border-b bg-muted/20">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <Tabs value={filter} onValueChange={(v: any) => setFilter(v)} className="w-full md:w-auto">
                            <TabsList className="bg-background border">
                                <TabsTrigger value="All">All</TabsTrigger>
                                <TabsTrigger value="Product">Products</TabsTrigger>
                                <TabsTrigger value="Service">Services</TabsTrigger>
                            </TabsList>
                        </Tabs>
                        <div className="relative w-full md:w-[300px]">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input placeholder="Search catalog..." className="pl-9 rounded-xl" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-muted/30">
                                <TableHead className="pl-6">Item</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead className="text-right">Price</TableHead>
                                <TableHead className="text-center">Availability</TableHead>
                                <TableHead className="text-right pr-6">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredItems.map((item) => (
                                <TableRow key={item.id} className="hover:bg-primary/5 transition-colors group">
                                    <TableCell className="pl-6">
                                        <div className="flex items-center gap-3">
                                            <div className="bg-primary/5 p-2 rounded-lg">
                                                {item.type === 'Product' ? <Box className="h-4 w-4 text-primary" /> : <Clock className="h-4 w-4 text-primary" />}
                                            </div>
                                            <div>
                                                <div className="font-bold text-sm">{item.name}</div>
                                                <div className="text-[10px] text-muted-foreground uppercase tracking-tighter">{item.sku || 'No SKU'}</div>
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell><Badge variant="outline" className="text-[10px] uppercase">{item.type}</Badge></TableCell>
                                    <TableCell className="text-right font-bold font-mono">₦{Number(item.price).toLocaleString()}</TableCell>
                                    <TableCell className="text-center font-mono text-xs">
                                        {item.type === 'Product' ? `${item.quantity} in stock` : `${item.duration} mins`}
                                    </TableCell>
                                    <TableCell className="text-right pr-6">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="rounded-full"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onClick={() => openEdit(item)}><Edit2 className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(item.id)}><Trash2 className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                <DialogContent className="sm:max-xl">
                    <DialogHeader><DialogTitle>Edit Catalog Entry</DialogTitle></DialogHeader>
                    <CatalogItemForm data={formData} setData={setFormData} />
                    <DialogFooter>
                        <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                        <Button onClick={handleSave}>Save Changes</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

function CatalogItemForm({ data, setData }: { data: Partial<CatalogItem>, setData: (d: any) => void }) {
    return (
        <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Item Type</Label>
                    <Select value={data.type} onValueChange={(val: any) => setData({...data, type: val})}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="Product">Product</SelectItem>
                            <SelectItem value="Service">Service</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label>Category</Label>
                    <Input placeholder="e.g. Parts" value={data.category} onChange={(e) => setData({...data, category: e.target.value})} />
                </div>
            </div>
            <div className="space-y-2">
                <Label>Item Name</Label>
                <Input value={data.name} onChange={(e) => setData({...data, name: e.target.value})} />
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Price (₦)</Label>
                    <Input type="number" value={data.price} onChange={(e) => setData({...data, price: parseFloat(e.target.value) || 0})} />
                </div>
                {data.type === 'Product' ? (
                    <div className="space-y-2">
                        <Label>SKU</Label>
                        <Input value={data.sku} onChange={(e) => setData({...data, sku: e.target.value})} />
                    </div>
                ) : (
                    <div className="space-y-2">
                        <Label>Duration (mins)</Label>
                        <Input type="number" value={data.duration} onChange={(e) => setData({...data, duration: parseInt(e.target.value) || 0})} />
                    </div>
                )}
            </div>
        </div>
    )
}
