"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { 
    Search, 
    ShoppingCart, 
    Plus, 
    Minus, 
    Trash2, 
    CreditCard, 
    Banknote, 
    ArrowRightLeft, 
    CheckCircle2, 
    Package,
    AlertCircle,
    UserCircle2
} from "lucide-react"
import { catalogItems } from "@/lib/data"
import type { CatalogItem } from "@/lib/data"
import { useToast } from "@/hooks/use-toast"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

type CartItem = CatalogItem & { cartQuantity: number }

export default function POSPage() {
    const [searchTerm, setSearchTerm] = React.useState("")
    const [cart, setCart] = React.useState<CartItem[]>([])
    const [inventory, setInventory] = React.useState<CatalogItem[]>(catalogItems.filter(item => item.type === 'Product'))
    const [paymentMethod, setPaymentMethod] = React.useState<"Cash" | "Card" | "Transfer">("Cash")
    const [isCheckoutOpen, setIsCheckoutOpen] = React.useState(false)
    const { toast } = useToast()

    const filteredInventory = inventory.filter(item => 
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        (item.sku && item.sku.toLowerCase().includes(searchTerm.toLowerCase()))
    )

    const addToCart = (item: CatalogItem) => {
        const availableQty = item.quantity || 0;
        if (availableQty <= 0) {
            toast({
                variant: "destructive",
                title: "Out of Stock",
                description: "Cannot add unavailable items to cart."
            })
            return
        }

        setCart(prev => {
            const existing = prev.find(i => i.id === item.id)
            if (existing) {
                if (existing.cartQuantity >= availableQty) {
                    toast({
                        variant: "destructive",
                        title: "Stock Limit Reached",
                        description: `Only ${availableQty} units available.`
                    })
                    return prev
                }
                return prev.map(i => i.id === item.id ? { ...i, cartQuantity: i.cartQuantity + 1 } : i)
            }
            return [...prev, { ...item, cartQuantity: 1 }]
        })
    }

    const updateCartQuantity = (id: string, delta: number) => {
        setCart(prev => prev.map(item => {
            if (item.id === id) {
                const maxQty = item.quantity || 0;
                const newQty = Math.max(1, Math.min(item.cartQuantity + delta, maxQty))
                return { ...item, cartQuantity: newQty }
            }
            return item
        }))
    }

    const handleQuantityInputChange = (id: string, val: string, max: number) => {
        const num = parseInt(val, 10);
        if (isNaN(num)) return;
        const safeQty = Math.max(1, Math.min(num, max));
        setCart(prev => prev.map(item => item.id === id ? { ...item, cartQuantity: safeQty } : item));
    }

    const removeFromCart = (id: string) => {
        setCart(prev => prev.filter(item => item.id !== id))
    }

    const subtotal = cart.reduce((acc, item) => acc + (item.price * item.cartQuantity), 0)
    const tax = subtotal * 0.075 // 7.5% VAT
    const total = subtotal + tax

    const handleCheckout = () => {
        toast({
            title: "Checkout Successful",
            description: `Sale of ₦${total.toLocaleString()} recorded. Inventory updated and transaction added to P&L.`,
        })

        setInventory(prev => prev.map(invItem => {
            const soldItem = cart.find(c => c.id === invItem.id)
            if (soldItem) {
                const currentQty = invItem.quantity || 0;
                const newQty = currentQty - soldItem.cartQuantity
                return { 
                    ...invItem, 
                    quantity: newQty,
                    status: newQty === 0 ? 'Out of Stock' : newQty <= (invItem.reorderLevel || 0) ? 'Low Stock' : 'In Stock'
                }
            }
            return invItem
        }))

        setCart([])
        setIsCheckoutOpen(false)
    }

    return (
        <div className="flex flex-col h-[calc(100vh-100px)] gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">POS Checkout</h1>
                    <p className="text-muted-foreground mt-1">Direct retail interface linked to your business ecosystem.</p>
                </div>
                <div className="flex items-center gap-4 bg-muted/50 p-2 rounded-xl border">
                    <UserCircle2 className="h-5 w-5 text-primary" />
                    <div className="text-xs">
                        <p className="font-bold">Register 01</p>
                        <p className="text-muted-foreground text-[10px] uppercase">Cashier: Jane Doe</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 overflow-hidden">
                <Card className="lg:col-span-7 flex flex-col overflow-hidden border-primary/5">
                    <CardHeader className="pb-4">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input 
                                placeholder="Search by name or scan SKU..." 
                                className="pl-10 h-11 rounded-xl shadow-sm border-primary/10" 
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </CardHeader>
                    <CardContent className="flex-1 overflow-hidden p-0">
                        <ScrollArea className="h-full px-6 pb-6">
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                                {filteredInventory.map((item) => (
                                    <button 
                                        key={item.id}
                                        onClick={() => addToCart(item)}
                                        className={cn(
                                            "group p-4 rounded-2xl border transition-all text-left flex flex-col gap-2 relative overflow-hidden",
                                            (item.quantity || 0) > 0 ? "hover:border-primary hover:shadow-lg hover:shadow-primary/5 bg-card" : "bg-muted/50 opacity-60 cursor-not-allowed"
                                        )}
                                    >
                                        <div className="flex justify-between items-start">
                                            <Badge variant={item.status === 'In Stock' ? 'secondary' : 'destructive'} className="text-[10px] px-1.5 h-4">
                                                {item.status}
                                            </Badge>
                                            <span className="text-xs font-mono text-muted-foreground">{item.sku}</span>
                                        </div>
                                        <div>
                                            <p className="font-bold line-clamp-1">{item.name}</p>
                                            <p className="text-primary font-headline font-bold text-lg">₦{item.price.toLocaleString()}</p>
                                        </div>
                                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-auto">
                                            <Package className="h-3 w-3" /> {item.quantity} in stock
                                        </div>
                                        {(item.quantity || 0) > 0 && (
                                            <div className="absolute right-2 bottom-2 bg-primary text-white p-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Plus className="h-4 w-4" />
                                            </div>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </ScrollArea>
                    </CardContent>
                </Card>

                <Card className="lg:col-span-5 flex flex-col overflow-hidden border-primary/20 shadow-xl shadow-primary/5">
                    <CardHeader className="bg-primary/5 border-b pb-4">
                        <div className="flex items-center justify-between">
                            <CardTitle className="flex items-center gap-2">
                                <ShoppingCart className="h-5 w-5 text-primary" />
                                Current Order
                            </CardTitle>
                            <Badge className="bg-primary text-primary-foreground">{cart.length} items</Badge>
                        </div>
                    </CardHeader>
                    <CardContent className="flex-1 overflow-hidden p-0">
                        {cart.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-30 gap-3">
                                <ShoppingCart className="h-16 w-16" />
                                <p className="font-medium">Cart is empty</p>
                            </div>
                        ) : (
                            <ScrollArea className="h-full">
                                <div className="p-4 space-y-4">
                                    {cart.map((item) => (
                                        <div key={item.id} className="flex items-center gap-4 bg-muted/20 p-3 rounded-xl border border-dashed">
                                            <div className="flex-1">
                                                <p className="font-bold text-sm">{item.name}</p>
                                                <p className="text-xs text-muted-foreground">₦{item.price.toLocaleString()} / unit</p>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <div className="flex items-center gap-1 bg-background border rounded-lg p-1">
                                                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => updateCartQuantity(item.id, -1)}><Minus className="h-3 w-3" /></Button>
                                                    <Input 
                                                        type="number"
                                                        value={item.cartQuantity}
                                                        onChange={(e) => handleQuantityInputChange(item.id, e.target.value, item.quantity || 0)}
                                                        className="w-10 h-6 text-center text-xs font-bold border-none shadow-none focus-visible:ring-0 p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none bg-transparent"
                                                    />
                                                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => updateCartQuantity(item.id, 1)}><Plus className="h-3 w-3" /></Button>
                                                </div>
                                                <p className="w-20 text-right font-bold font-headline">₦{(item.price * item.cartQuantity).toLocaleString()}</p>
                                                <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => removeFromCart(item.id)}>
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </ScrollArea>
                        )}
                    </CardContent>
                    <CardFooter className="flex flex-col gap-4 p-6 bg-muted/30 border-t">
                        <div className="w-full space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Subtotal</span>
                                <span>₦{subtotal.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">VAT (7.5%)</span>
                                <span>₦{tax.toLocaleString()}</span>
                            </div>
                            <Separator className="my-2" />
                            <div className="flex justify-between items-center">
                                <span className="text-lg font-bold">Total Amount</span>
                                <span className="text-2xl font-bold font-headline text-primary">₦{total.toLocaleString()}</span>
                            </div>
                        </div>

                        <Dialog open={isCheckoutOpen} onOpenChange={setIsCheckoutOpen}>
                            <DialogTrigger asChild>
                                <Button className="w-full h-14 rounded-xl text-lg font-bold shadow-lg shadow-primary/20" disabled={cart.length === 0}>
                                    Complete Checkout
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-md">
                                <DialogHeader>
                                    <DialogTitle className="text-2xl">Finalize Payment</DialogTitle>
                                    <DialogDescription>Select the customer's preferred payment method.</DialogDescription>
                                </DialogHeader>
                                <div className="grid gap-6 py-4">
                                    <div className="grid grid-cols-3 gap-3">
                                        <Button 
                                            variant={paymentMethod === 'Cash' ? 'default' : 'outline'} 
                                            className="flex flex-col gap-2 h-20 rounded-xl"
                                            onClick={() => setPaymentMethod('Cash')}
                                        >
                                            <Banknote className="h-5 w-5" />
                                            <span>Cash</span>
                                        </Button>
                                        <Button 
                                            variant={paymentMethod === 'Card' ? 'default' : 'outline'} 
                                            className="flex flex-col gap-2 h-20 rounded-xl"
                                            onClick={() => setPaymentMethod('Card')}
                                        >
                                            <CreditCard className="h-5 w-5" />
                                            <span>POS Card</span>
                                        </Button>
                                        <Button 
                                            variant={paymentMethod === 'Transfer' ? 'default' : 'outline'} 
                                            className="flex flex-col gap-2 h-20 rounded-xl"
                                            onClick={() => setPaymentMethod('Transfer')}
                                        >
                                            <ArrowRightLeft className="h-5 w-5" />
                                            <span>Transfer</span>
                                        </Button>
                                    </div>
                                    <div className="p-4 rounded-xl bg-primary/5 border border-primary/10 flex items-center justify-between">
                                        <span className="font-medium">Amount to Collect</span>
                                        <span className="text-xl font-bold font-headline text-primary">₦{total.toLocaleString()}</span>
                                    </div>
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Inventory will be automatically decremented.
                                        </div>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Transaction recorded in Profit & Loss.
                                        </div>
                                    </div>
                                </div>
                                <DialogFooter>
                                    <Button className="w-full h-12 text-lg" onClick={handleCheckout}>
                                        Confirm & Print Receipt
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </CardFooter>
                </Card>
            </div>
        </div>
    )
}
