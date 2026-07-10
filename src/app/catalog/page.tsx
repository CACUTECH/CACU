"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PlusCircle, Search, MoreHorizontal, Package, Briefcase, Filter, Box, Clock, Loader2, Trash2, Edit2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { catalogItems as initialItems } from "@/lib/data"
import type { CatalogItem, BusinessType, PricingModel, CatalogItemType } from "@/lib/data"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"

export default function CatalogPage() {
    const { toast } = useToast()
    const [searchTerm, setSearchTerm] = React.useState("")
    const [filter, setFilter] = React.useState<'All' | 'Product' | 'Service'>('All')
    const [items, setItems] = React.useState<CatalogItem[]>(initialItems)
    const [businessType, setBusinessType] = React.useState<BusinessType>('HYBRID')
    const [isAddOpen, setIsAddOpen] = React.useState(false)
    const [isEditOpen, setIsEditOpen] = React.useState(false)
    const [selectedItem, setSelectedItem] = React.useState<CatalogItem | null>(null)
    const [mounted, setMounted] = React.useState(false)

    // Form State for Add/Edit
    const [formData, setFormData] = React.useState<Partial<CatalogItem>>({
        type: 'Product',
        name: '',
        category: '',
        price: 0,
        description: '',
        sku: '',
        quantity: 0,
        reorderLevel: 5,
        duration: 30,
        pricingModel: 'Fixed'
    })

    React.useEffect(() => {
        setMounted(true)
        const savedType = localStorage.getItem('business-type') as BusinessType
        if (savedType) {
            setBusinessType(savedType)
            if (savedType === 'PRODUCT') setFilter('Product')
            else if (savedType === 'SERVICE') setFilter('Service')
            else setFilter('All')
        }
    }, [])

    const filteredItems = items.filter(item => {
        const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                             item.category.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesFilter = filter === 'All' || item.type === filter;
        return matchesSearch && matchesFilter;
    })

    const handleAddItem = () => {
        if (!formData.name || !formData.category) {
            toast({ variant: "destructive", title: "Missing Fields", description: "Name and Category are required." })
            return
        }

        const newItem: CatalogItem = {
            id: `cat-${Date.now()}`,
            type: formData.type as CatalogItemType,
            name: formData.name!,
            category: formData.category!,
            description: formData.description || '',
            price: formData.price || 0,
            status: formData.type === 'Product' 
                ? ((formData.quantity || 0) > (formData.reorderLevel || 0) ? 'In Stock' : 'Low Stock') 
                : 'Active',
            sku: formData.sku,
            quantity: formData.quantity,
            reorderLevel: formData.reorderLevel,
            duration: formData.duration,
            pricingModel: formData.pricingModel as PricingModel
        }

        setItems([newItem, ...items])
        setIsAddOpen(false)
        resetForm()
        toast({ title: "Item Added", description: `${newItem.name} has been added to your catalog.` })
    }

    const handleUpdateItem = () => {
        if (!selectedItem || !formData.name) return

        const updatedItems = items.map(item => {
            if (item.id === selectedItem.id) {
                return {
                    ...item,
                    ...formData,
                    status: formData.type === 'Product' 
                        ? ((formData.quantity || 0) > (formData.reorderLevel || 0) ? 'In Stock' : 'Low Stock') 
                        : 'Active',
                } as CatalogItem
            }
            return item
        })

        setItems(updatedItems)
        setIsEditOpen(false)
        setSelectedItem(null)
        resetForm()
        toast({ title: "Item Updated", description: "The catalog entry has been successfully updated." })
    }

    const handleDeleteItem = (id: string) => {
        setItems(items.filter(item => item.id !== id))
        toast({ title: "Item Removed", description: "The item has been deleted from your catalog." })
    }

    const resetForm = () => {
        setFormData({
            type: businessType === 'SERVICE' ? 'Service' : 'Product',
            name: '',
            category: '',
            price: 0,
            description: '',
            sku: '',
            quantity: 0,
            reorderLevel: 5,
            duration: 30,
            pricingModel: 'Fixed'
        })
    }

    const openEdit = (item: CatalogItem) => {
        setSelectedItem(item)
        setFormData(item)
        setIsEditOpen(true)
    }

    if (!mounted) return null

    const pageTitle = businessType === 'SERVICE' ? 'Service Menu' : businessType === 'PRODUCT' ? 'Product Catalog' : 'Business Catalog';
    const pageDesc = businessType === 'SERVICE' ? 'Manage your professional services and billable hours.' : businessType === 'PRODUCT' ? 'Manage your inventory and retail goods.' : 'Manage your unified list of goods and billable services.';

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight text-foreground">{pageTitle}</h1>
                    <p className="text-muted-foreground mt-1">{pageDesc}</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => toast({ title: "Bulk Actions", description: "This feature will allow exporting and mass updates soon." })}>
                        <Filter className="mr-2 h-4 w-4" />
                        Bulk Actions
                    </Button>
                    
                    <Dialog open={isAddOpen} onOpenChange={(open) => { setIsAddOpen(open); if(open) resetForm(); }}>
                        <DialogTrigger asChild>
                            <Button size="sm">
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Add New {businessType === 'SERVICE' ? 'Service' : 'Item'}
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-xl">
                            <DialogHeader>
                                <DialogTitle className="font-headline">Add Catalog Entry</DialogTitle>
                                <DialogDescription>Create a new product or service record.</DialogDescription>
                            </DialogHeader>
                            <CatalogItemForm data={formData} setData={setFormData} businessType={businessType} />
                            <DialogFooter>
                                <DialogClose asChild>
                                    <Button variant="outline">Cancel</Button>
                                </DialogClose>
                                <Button onClick={handleAddItem}>Create Entry</Button>
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
                                <TabsTrigger value="All" className="data-[state=active]:bg-primary data-[state=active]:text-white">All Items</TabsTrigger>
                                {(businessType === 'HYBRID' || businessType === 'PRODUCT') && (
                                    <TabsTrigger value="Product" className="flex gap-2"><Box className="h-4 w-4" /> Products</TabsTrigger>
                                )}
                                {(businessType === 'HYBRID' || businessType === 'SERVICE') && (
                                    <TabsTrigger value="Service" className="flex gap-2"><Clock className="h-4 w-4" /> Services</TabsTrigger>
                                )}
                            </TabsList>
                        </Tabs>
                        <div className="relative w-full md:w-[300px]">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input 
                                placeholder="Search name or category..." 
                                className="pl-9 rounded-xl" 
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-muted/30">
                                <TableHead className="pl-6">Item</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Category</TableHead>
                                <TableHead className="text-right">Price</TableHead>
                                <TableHead className="text-center">
                                    {filter === 'Service' ? 'Duration' : filter === 'Product' ? 'Stock' : 'Qty / Time'}
                                </TableHead>
                                <TableHead className="text-center">Status</TableHead>
                                <TableHead className="w-[50px]"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredItems.map((item) => (
                                <TableRow key={item.id} className="hover:bg-primary/5 transition-colors group">
                                    <TableCell className="pl-6">
                                        <div className="flex items-center gap-3">
                                            <div className="bg-primary/5 p-2 rounded-lg group-hover:bg-primary/10 transition-colors">
                                                {item.type === 'Product' ? <Box className="h-4 w-4 text-primary" /> : <Clock className="h-4 w-4 text-primary" />}
                                            </div>
                                            <div>
                                                <div className="font-bold text-sm">{item.name}</div>
                                                <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-tighter">{item.sku || 'N/A'}</div>
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className="text-[10px] uppercase">{item.type}</Badge>
                                    </TableCell>
                                    <TableCell className="text-sm font-medium">{item.category}</TableCell>
                                    <TableCell className="text-right font-bold font-mono">
                                        ₦{item.price.toLocaleString()}
                                        {item.pricingModel && <span className="text-[10px] text-muted-foreground ml-1">/{item.pricingModel.toLowerCase()}</span>}
                                    </TableCell>
                                    <TableCell className="text-center font-mono text-sm">
                                        {item.type === 'Product' ? (
                                            <span className={cn((item.quantity || 0) <= (item.reorderLevel || 0) ? "text-red-500 font-bold" : "")}>
                                                {item.quantity} units
                                            </span>
                                        ) : (
                                            <span className="text-muted-foreground">{item.duration} mins</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-center">
                                        <Badge 
                                            variant={item.status === 'In Stock' || item.status === 'Active' ? 'default' : 'destructive'}
                                            className={cn(
                                                "text-[10px]",
                                                (item.status === 'In Stock' || item.status === 'Active') && "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 border-emerald-500/20"
                                            )}
                                        >
                                            {item.status}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="rounded-full">
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="rounded-xl w-48">
                                                <DropdownMenuLabel>Catalog Options</DropdownMenuLabel>
                                                <DropdownMenuItem onClick={() => openEdit(item)}><Edit2 className="h-4 w-4 mr-2" /> Edit Item</DropdownMenuItem>
                                                <DropdownMenuItem>View Analytics</DropdownMenuItem>
                                                {item.type === 'Product' && <DropdownMenuItem>Update Stock</DropdownMenuItem>}
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem className="text-destructive" onClick={() => handleDeleteItem(item.id)}><Trash2 className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {filteredItems.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                                        No items found matching your criteria.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                <DialogContent className="sm:max-xl">
                    <DialogHeader>
                        <DialogTitle className="font-headline">Edit Catalog Entry</DialogTitle>
                        <DialogDescription>Modify details for {selectedItem?.name}.</DialogDescription>
                    </DialogHeader>
                    <CatalogItemForm data={formData} setData={setFormData} businessType={businessType} />
                    <DialogFooter>
                        <DialogClose asChild>
                            <Button variant="outline">Cancel</Button>
                        </DialogClose>
                        <Button onClick={handleUpdateItem}>Save Changes</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

function CatalogItemForm({ data, setData, businessType }: { data: Partial<CatalogItem>, setData: (d: any) => void, businessType: BusinessType }) {
    const handleNumericChange = (field: string, value: string) => {
        const num = value === "" ? 0 : parseFloat(value);
        setData({ ...data, [field]: num });
    };

    return (
        <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Item Type</Label>
                    <Select 
                        value={data.type} 
                        onValueChange={(val: any) => setData({...data, type: val})}
                        disabled={businessType !== 'HYBRID'}
                    >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="Product">Product</SelectItem>
                            <SelectItem value="Service">Service</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label>Category</Label>
                    <Input 
                        placeholder="e.g. Maintenance" 
                        value={data.category} 
                        onChange={(e) => setData({...data, category: e.target.value})} 
                    />
                </div>
            </div>

            <div className="space-y-2">
                <Label>Item Name</Label>
                <Input 
                    placeholder="e.g. Premium Engine Oil" 
                    value={data.name} 
                    onChange={(e) => setData({...data, name: e.target.value})} 
                />
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Selling Price (₦)</Label>
                    <Input 
                        type="number" 
                        value={isNaN(data.price as any) ? "" : data.price} 
                        onChange={(e) => handleNumericChange('price', e.target.value)} 
                    />
                </div>
                {data.type === 'Service' && (
                    <div className="space-y-2">
                        <Label>Pricing Model</Label>
                        <Select 
                            value={data.pricingModel} 
                            onValueChange={(val: any) => setData({...data, pricingModel: val})}
                        >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="Fixed">Fixed Price</SelectItem>
                                <SelectItem value="Hourly">Hourly Rate</SelectItem>
                                <SelectItem value="Project">Per Project</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                )}
            </div>

            {data.type === 'Product' ? (
                <div className="grid grid-cols-3 gap-4 p-4 rounded-xl bg-muted/30 border border-dashed">
                    <div className="space-y-2">
                        <Label>SKU</Label>
                        <Input value={data.sku} onChange={(e) => setData({...data, sku: e.target.value})} />
                    </div>
                    <div className="space-y-2">
                        <Label>Stock Qty</Label>
                        <Input 
                            type="number" 
                            value={isNaN(data.quantity as any) ? "" : data.quantity} 
                            onChange={(e) => handleNumericChange('quantity', e.target.value)} 
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Reorder Level</Label>
                        <Input 
                            type="number" 
                            value={isNaN(data.reorderLevel as any) ? "" : data.reorderLevel} 
                            onChange={(e) => handleNumericChange('reorderLevel', e.target.value)} 
                        />
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 p-4 rounded-xl bg-muted/30 border border-dashed">
                    <div className="space-y-2">
                        <Label>Average Duration (minutes)</Label>
                        <Input 
                            type="number" 
                            value={isNaN(data.duration as any) ? "" : data.duration} 
                            onChange={(e) => handleNumericChange('duration', e.target.value)} 
                        />
                    </div>
                </div>
            )}

            <div className="space-y-2">
                <Label>Internal Description</Label>
                <Textarea 
                    placeholder="Short description for internal records..." 
                    className="h-20"
                    value={data.description}
                    onChange={(e) => setData({...data, description: e.target.value})}
                />
            </div>
        </div>
    )
}
