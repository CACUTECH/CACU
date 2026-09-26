
"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
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
    Loader2,
    UserCircle2
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { processCheckoutAction } from "./actions"

type CatalogItem = {
    id: string;
    name: string;
    price: number;
    sku?: string;
    quantity?: number;
    status: string;
}

type CartItem = CatalogItem & { cartQuantity: number }

export default function POSPage() {
    const supabase = createClient();
    const { toast } = useToast()
    
    const [searchTerm, setSearchTerm] = React.useState("")
    const [cart, setCart] = React.useState<CartItem[]>([])
    const [inventory, setInventory] = React.useState<CatalogItem[]>([])
    const [loading, setLoading] = React.useState(true)
    const [paymentMethod, setPaymentMethod] = React.useState<"Cash" | "Card" | "Transfer">("Cash")
    const [isCheckoutOpen, setIsCheckoutOpen] = React.useState(false)
    const [isProcessing, setIsProcessing] = React.useState(false)

    const fetchInventory = React.useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('catalog_items')
            .select('*, type:item_type, price:unit_price, quantity:stock_quantity')
            .eq('item_type', 'Product')
            .order('name');
        
        if (!error) setInventory(data || []);
        setLoading(false);
    }, [supabase]);

    React.useEffect(() => {
        fetchInventory();
    }, [fetchInventory]);

    const filteredInventory = inventory.filter(item => 
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        (item.sku && item.sku.toLowerCase().includes(searchTerm.toLowerCase()))
    )

    const addToCart = (item: CatalogItem) => {
        if ((item.quantity || 0) <= 0) {
            toast({ variant: "destructive", title: "Out of Stock" });
            return;
        }

        setCart(prev => {
            const existing = prev.find(i => i.id === item.id)
            if (existing) {
                if (existing.cartQuantity >= (item.quantity || 0)) {
                    toast({ variant: "destructive", title: "Limit Reached" });
                    return prev;
                }
                return prev.map(i => i.id === item.id ? { ...i, cartQuantity: i.cartQuantity + 1 } : i)
            }
            return [...prev, { ...item, cartQuantity: 1 }]
        })
    }

    const updateCartQuantity = (id: string, delta: number) => {
        setCart(prev => prev.map(item => {
            if (item.id === id) {
                const max = item.quantity || 0;
                return { ...item, cartQuantity: Math.max(1, Math.min(item.cartQuantity + delta, max)) }
            }
            return item
        }))
    }

    const subtotal = cart.reduce((acc, item) => acc + (item.price * item.cartQuantity), 0)
    const tax = subtotal * 0.075 
    const total = subtotal + tax

    const handleCheckout = async () => {
        setIsProcessing(true);
        
        const saleData = {
            items: cart.map(item => ({ id: item.id, quantity: item.cartQuantity, price: item.price })),
            paymentMethod,
            totalAmount: total
        };

        const result = await processCheckoutAction(saleData);

        if (result.success) {
            toast({ title: "Sale Recorded", description: `Receipt #${result.saleId.substring(0,8)} generated.` });
            setCart([]);
            setIsCheckoutOpen(false);
            fetchInventory();
        } else {
            toast({ variant: "destructive", title: "Checkout Failed", description: result.error });
        }
        setIsProcessing(false);
    }

    if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

    return (
        <div className="flex flex-col h-[calc(100vh-100px)] gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">POS Checkout</h1>
                    <p className="text-muted-foreground mt-1">Live retail interface linked to your relational backend.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 overflow-hidden">
                <Card className="lg:col-span-7 flex flex-col overflow-hidden border-primary/5">
                    <CardHeader className="pb-4">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input 
                                placeholder="Search inventory or scan SKU..." 
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
                                            (item.quantity || 0) > 0 ? "hover:border-primary hover:shadow-lg bg-card" : "bg-muted/50 opacity-60 cursor-not-allowed"
                                        )}
                                    >
                                        <div className="flex justify-between items-start">
                                            <Badge variant={item.quantity && item.quantity > 5 ? 'secondary' : 'destructive'} className="text-[10px]">
                                                {item.quantity && item.quantity > 0 ? `${item.quantity} In Stock` : 'Out of Stock'}
                                            </Badge>
                                        </div>
                                        <div>
                                            <p className="font-bold line-clamp-1">{item.name}</p>
                                            <p className="text-primary font-headline font-bold text-lg">₦{Number(item.price).toLocaleString()}</p>
                                        </div>
                                        <div className="absolute right-2 bottom-2 bg-primary text-white p-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Plus className="h-4 w-4" />
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </ScrollArea>
                    </CardContent>
                </Card>

                <Card className="lg:col-span-5 flex flex-col overflow-hidden border-primary/20 shadow-xl shadow-primary/5">
                    <CardHeader className="bg-primary/5 border-b pb-4">
                        <CardTitle className="flex items-center gap-2">
                            <ShoppingCart className="h-5 w-5 text-primary" />
                            Active Cart
                        </CardTitle>
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
                                                <p className="text-xs text-muted-foreground">₦{Number(item.price).toLocaleString()}</p>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <div className="flex items-center gap-1 bg-background border rounded-lg p-1">
                                                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => updateCartQuantity(item.id, -1)}><Minus className="h-3 w-3" /></Button>
                                                    <span className="w-8 text-center text-xs font-bold">{item.cartQuantity}</span>
                                                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => updateCartQuantity(item.id, 1)}><Plus className="h-3 w-3" /></Button>
                                                </div>
                                                <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => setCart(cart.filter(i => i.id !== item.id))}>
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
                                    <DialogTitle className="text-2xl">Payment Settlement</DialogTitle>
                                    <DialogDescription>Finalize the sale and sync records.</DialogDescription>
                                </DialogHeader>
                                <div className="grid gap-6 py-4">
                                    <div className="grid grid-cols-3 gap-3">
                                        <Button variant={paymentMethod === 'Cash' ? 'default' : 'outline'} className="flex flex-col gap-2 h-20" onClick={() => setPaymentMethod('Cash')}>
                                            <Banknote className="h-5 w-5" /><span>Cash</span>
                                        </Button>
                                        <Button variant={paymentMethod === 'Card' ? 'default' : 'outline'} className="flex flex-col gap-2 h-20" onClick={() => setPaymentMethod('Card')}>
                                            <CreditCard className="h-5 w-5" /><span>Card</span>
                                        </Button>
                                        <Button variant={paymentMethod === 'Transfer' ? 'default' : 'outline'} className="flex flex-col gap-2 h-20" onClick={() => setPaymentMethod('Transfer')}>
                                            <ArrowRightLeft className="h-5 w-5" /><span>Transfer</span>
                                        </Button>
                                    </div>
                                    <div className="p-4 rounded-xl bg-primary/5 border border-primary/10 flex items-center justify-between font-bold">
                                        <span>Payable Amount</span>
                                        <span className="text-xl text-primary">₦{total.toLocaleString()}</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground italic flex items-center gap-2">
                                        <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Transactional integrity enforced by PostgreSQL.
                                    </p>
                                </div>
                                <DialogFooter>
                                    <Button className="w-full h-12 text-lg" onClick={handleCheckout} disabled={isProcessing}>
                                        {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Confirm & Record Sale"}
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
