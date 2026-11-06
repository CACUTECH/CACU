"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Search, ShoppingCart, Plus, Minus, Trash2, Loader2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { getActiveBusinessIdAction } from '@/app/business-actions';
import { getCheckoutOptionsAction, processCheckoutAction } from "./actions"
import { getCollectionAccountsAction } from '@/app/accounting/collection-actions';
import type { CollectionAccounts } from '@/lib/collection-accounts';
import { CollectionAccountPicker } from '@/components/collection-account-picker';
import { formatKobo, kobo, lineKobo, nairaText, validDiscount, type CheckoutOptions, type ParkedSale } from '@/lib/checkout';
import { ShiftBar } from '@/components/shift-bar';
import type { ShiftStatus } from '@/lib/shifts';
import { getBookingBillAction } from '@/app/appointments/actions';
import type { BookingBill } from '@/lib/bookings';
import { getJobMoneyAction } from '@/app/jobs/actions';
import { matchesJob, type JobMoney } from '@/lib/jobs';

type CatalogItem = { id: string; name: string; price: number; sku?: string; quantity?: number; type?: string; track_stock?: boolean; status: string; }
type CartItem = CatalogItem & { cartQuantity: number; discount: string }
type Method = 'Cash' | 'Transfer' | 'Split' | 'Credit'
type Customer = { id: string; name: string }
type Done = { saleId: string; status: string; change: string | null; invoiceNumber: string | null; shortfalls: { item_id: string; quantity: number }[] }

const METHODS: { value: Method; label: string }[] = [
    { value: 'Cash', label: 'Cash' }, { value: 'Transfer', label: 'Transfer' }, { value: 'Split', label: 'Cash + transfer' }, { value: 'Credit', label: 'On credit' },
];

const tracked = (item: CatalogItem) => item.type === 'PRODUCT' && item.track_stock !== false;

// useSearchParams needs a Suspense boundary for the production build.
export default function POSPage() {
    return <React.Suspense fallback={null}><PointOfSale /></React.Suspense>
}

function PointOfSale() {
    const [supabase] = React.useState(() => createClient());
    const { toast } = useToast()

    const [taxRate, setTaxRate] = React.useState<number | null>(null)
    const [searchTerm, setSearchTerm] = React.useState("")
    const [cart, setCart] = React.useState<CartItem[]>([])
    const [inventory, setInventory] = React.useState<CatalogItem[]>([])
    const [loading, setLoading] = React.useState(true)
    const [collectionChoices, setCollectionChoices] = React.useState<CollectionAccounts | null>(null);
    const [options, setOptions] = React.useState<CheckoutOptions | null>(null);
    const [customers, setCustomers] = React.useState<Customer[]>([]);
    const [bankAccountId, setBankAccountId] = React.useState('');
    const [paymentMethod, setPaymentMethod] = React.useState<Method>("Cash")
    const [cashReceived, setCashReceived] = React.useState('');
    const [transferAmount, setTransferAmount] = React.useState('');
    const [customerId, setCustomerId] = React.useState('');
    const [isCheckoutOpen, setIsCheckoutOpen] = React.useState(false)
    const [isProcessing, setIsProcessing] = React.useState(false)
    const [done, setDone] = React.useState<Done | null>(null);
    const [businessId, setBusinessId] = React.useState<string | null>(null);
    const [parked, setParked] = React.useState<ParkedSale[]>([]);
    const [parkOpen, setParkOpen] = React.useState(false), [parkedOpen, setParkedOpen] = React.useState(false);
    const [parkLabel, setParkLabel] = React.useState(''), [parking, setParking] = React.useState(false);
    const [shiftStatus, setShiftStatus] = React.useState<ShiftStatus | null>(null);
    // Doc 10 / PR-13: paying for a completed booking (/pos?booking=...); a held deposit comes off what is due.
    const search = useSearchParams();
    const bookingId = search?.get('booking') ?? null;
    // A completed job (/pos?job=...) is sold exactly as its lines; its materials already left stock.
    const jobId = search?.get('job') ?? null;
    const [job, setJob] = React.useState<JobMoney | null>(null);
    const [bill, setBill] = React.useState<BookingBill | null>(null);

    const native = collectionChoices?.native === true;
    const cap = Number(options?.discount_cap ?? 0);
    const oversell = options?.allow_oversell === true;

    const fetchInventory = React.useCallback(async () => {
        try {
            setLoading(true);
            setCollectionChoices(null);
            const [choices, checkout] = await Promise.all([getCollectionAccountsAction(), getCheckoutOptionsAction().catch(() => null)]);
            setCollectionChoices(choices);
            setOptions(checkout);
            setTaxRate(choices.native ? 0 : 0.075);
            const businessId = await getActiveBusinessIdAction();
            setBusinessId(businessId);
            const { data, error } = await supabase
                .from('catalog_items')
                .select('*, type:item_type, price:unit_price, quantity:stock_quantity').eq('business_id', businessId)
                .eq('is_active', true)
                .order('name');
            if (!error) setInventory(data || []);
            if (choices.native) {
                const { data: people } = await supabase.from('customers').select('id, name').eq('business_id', businessId).order('name').limit(500);
                setCustomers(people || []);
            }
            setLoading(false);
        } catch {
            toast({ variant: "destructive", title: "Business data unavailable", description: "Refresh your session and active business selection, then retry." });
            setLoading(false);
        }
    }, [supabase, toast]);

    React.useEffect(() => { fetchInventory(); }, [fetchInventory]);

    // Doc 10 parked sales: saved to resume later; nothing is posted, and prices are read again from the catalogue on resume.
    const loadParked = React.useCallback(async () => {
        if (!businessId) return;
        const { data } = await supabase.from('parked_sales').select('id, label, items, created_at').eq('business_id', businessId).order('created_at');
        setParked((data as ParkedSale[] | null) || []);
    }, [supabase, businessId]);
    React.useEffect(() => { void loadParked(); }, [loadParked]);

    React.useEffect(() => {
        if (!bookingId || loading || !native) return;
        let live = true;
        void getBookingBillAction(bookingId).then(result => {
            if (!live) return;
            if (!result.success) { toast({ variant: "destructive", title: "Booking unavailable", description: result.error }); return; }
            const booking = result.data;
            if (booking.bill_kind) { toast({ title: "Already billed", description: "This booking has already been paid or invoiced." }); return; }
            if (booking.status !== 'completed') { toast({ variant: "destructive", title: "Complete the booking first", description: "Mark the booking completed on Appointments, then take payment." }); return; }
            const service = inventory.find(i => i.id === booking.service_id);
            if (!service) { toast({ variant: "destructive", title: "Service unavailable", description: "The booked service is not active in your catalogue." }); return; }
            setBill(booking);
            setCart([{ ...service, cartQuantity: 1, discount: '0' }]);
        });
        return () => { live = false; };
    }, [bookingId, loading, native, inventory, toast]);

    React.useEffect(() => {
        if (!jobId || loading || !native) return;
        let live = true;
        void getJobMoneyAction(jobId).then(result => {
            if (!live) return;
            if (!result.success || !result.data) { toast({ variant: "destructive", title: "Job unavailable", description: result.success ? 'Turn on your books to bill jobs.' : result.error }); return; }
            const found = result.data;
            if (found.bill_kind) { toast({ title: "Already billed", description: "This job has already been paid or invoiced." }); return; }
            if (found.status !== 'completed') { toast({ variant: "destructive", title: "Complete the job first", description: "Complete the job, then take payment." }); return; }
            const restored: CartItem[] = [];
            for (const line of found.lines) {
                const item = inventory.find(i => i.id === line.item_id);
                if (!item) { toast({ variant: "destructive", title: "Item unavailable", description: `${line.name} is no longer active in your catalogue.` }); return; }
                restored.push({ ...item, cartQuantity: line.quantity, discount: '0' });
            }
            setJob(found);
            setCart(restored);
        });
        return () => { live = false; };
    }, [jobId, loading, native, inventory, toast]);

    const filteredInventory = inventory.filter(item =>
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (item.sku && item.sku.toLowerCase().includes(searchTerm.toLowerCase()))
    )

    // Doc 10 / BR-022: a sale cannot take recorded stock below zero unless the owner allowed overselling.
    const limitFor = (item: CatalogItem) => tracked(item) && !oversell ? item.quantity || 0 : 1000000;

    const addToCart = (item: CatalogItem) => {
        if (limitFor(item) <= 0) { toast({ variant: "destructive", title: "Out of Stock" }); return; }
        setCart(prev => {
            const existing = prev.find(i => i.id === item.id)
            if (existing) {
                if (existing.cartQuantity >= limitFor(item)) { toast({ variant: "destructive", title: "Limit Reached" }); return prev; }
                return prev.map(i => i.id === item.id ? { ...i, cartQuantity: i.cartQuantity + 1 } : i)
            }
            return [...prev, { ...item, cartQuantity: 1, discount: '0' }]
        })
    }

    const updateCartQuantity = (id: string, delta: number) => {
        setCart(prev => prev.map(item => item.id === id ? { ...item, cartQuantity: Math.max(1, Math.min(item.cartQuantity + delta, limitFor(item))) } : item))
    }
    const setDiscount = (id: string, value: string) => setCart(prev => prev.map(item => item.id === id ? { ...item, discount: value } : item));

    const lines = cart.map(item => ({ item, ...lineKobo(item.price, item.cartQuantity, native && validDiscount(item.discount, cap) ? item.discount : 0) }));
    const totalKobo = native ? lines.reduce((sum, line) => sum + line.net, 0) : Math.round(lines.reduce((sum, line) => sum + line.gross, 0) * (1 + (taxRate ?? 0)));
    const discountKobo = lines.reduce((sum, line) => sum + line.discount, 0);
    const badDiscount = native && cart.some(item => !validDiscount(item.discount, cap));
    const shortBy = (item: CartItem) => tracked(item) ? Math.max(0, item.cartQuantity - Math.max(item.quantity || 0, 0)) : 0;

    // What is still missing before the sale can be recorded, in plain words; empty when ready.
    const depositKobo = bill?.deposit?.status === 'held' ? kobo(bill.deposit.amount) : 0;
    const transferKobo = paymentMethod === 'Split' && /^\d+(\.\d{1,2})?$/.test(transferAmount) ? kobo(transferAmount) : 0;
    const cashDue = paymentMethod === 'Cash' ? totalKobo - depositKobo : paymentMethod === 'Split' ? totalKobo - transferKobo : 0;
    const cashKobo = /^\d+(\.\d{1,2})?$/.test(cashReceived) ? kobo(cashReceived) : null;
    // Doc 10 shifts: when the owner requires one, nobody sells without an open shift.
    const needsShift = native && shiftStatus?.available === true && shiftStatus.require_shift && !shiftStatus.shift;
    const problem = !native ? '' : needsShift ? 'Open your shift before selling. The owner requires a shift for every sale.'
        : bill?.deposit?.status === 'awaiting_transfer' ? "This booking's deposit transfer is still awaiting confirmation. Confirm it on Daily reconciliation first."
        : depositKobo > 0 && !['Cash', 'Transfer'].includes(paymentMethod) ? 'A booking with a deposit is paid in cash or by transfer. Bill it by invoice for credit.'
        : depositKobo > totalKobo ? 'The deposit is more than this sale. Add the booked service at its full price.'
        : depositKobo > 0 && paymentMethod === 'Transfer' && depositKobo === totalKobo ? 'The deposit covers the whole bill. Choose Cash to finish.'
        : bill && !cart.some(i => i.id === bill.service_id) ? 'Add the booked service back to the cart.'
        : job && !matchesJob(cart.map(i => ({ id: i.id, quantity: i.cartQuantity })), job.lines) ? "The sale must be exactly the job's services and materials. Change the job instead." 
        : badDiscount ? `Discounts can be at most ${cap}%.`
        : paymentMethod === 'Split' && (transferKobo <= 0 || transferKobo >= totalKobo) ? 'Enter a transfer amount less than the total.'
        : paymentMethod === 'Credit' && !customerId ? 'Choose the customer who owes for this sale.'
        : paymentMethod === 'Credit' && discountKobo > 0 ? 'Discounts are not available on credit sales yet.'
        : cashReceived && cashKobo === null ? 'Enter the cash received in naira, for example 5000.'
        : cashKobo !== null && cashKobo < cashDue ? `Cash received is less than the ${nairaText(cashDue)} due.` : '';
    const change = cashKobo !== null && cashKobo >= cashDue && cashDue > 0 ? cashKobo - cashDue : null;

    const parkSale = async () => {
        if (!businessId || cart.length === 0 || parking) return;
        setParking(true);
        const { error } = await supabase.from('parked_sales').insert({ business_id: businessId, label: parkLabel.trim().slice(0, 60),
            items: cart.map(item => ({ item_id: item.id, quantity: item.cartQuantity, discount_percent: item.discount || '0' })) });
        setParking(false);
        if (error) { toast({ variant: "destructive", title: "Sale not parked", description: "You may not have permission to sell. Try again or ask the owner." }); return; }
        setCart([]); setParkLabel(''); setParkOpen(false);
        toast({ title: "Sale parked", description: "Resume it from Parked sales when the customer is ready." });
        void loadParked();
    };

    // Resuming or discarding removes the parked sale first, so two tills cannot both take it.
    const takeParked = async (sale: ParkedSale, resume: boolean) => {
        const { data, error } = await supabase.from('parked_sales').delete().eq('id', sale.id).select('id');
        if (error || !data?.length) { toast({ variant: "destructive", title: "Already taken", description: "Another till resumed or discarded this sale." }); void loadParked(); return; }
        if (resume) {
            let missing = 0;
            const restored: CartItem[] = [];
            for (const line of sale.items) {
                const item = inventory.find(i => i.id === line.item_id);
                const quantity = item ? Math.min(line.quantity, limitFor(item)) : 0;
                if (!item || quantity <= 0) { missing += 1; continue; }
                restored.push({ ...item, cartQuantity: quantity, discount: native ? line.discount_percent || '0' : '0' });
            }
            setCart(restored);
            if (missing) toast({ title: "Some items were not added back", description: "They are no longer for sale or are out of stock." });
        }
        setParkedOpen(false);
        void loadParked();
    };

    const checkoutKey = React.useRef(crypto.randomUUID());
    const handleCheckout = async () => {
        if (taxRate === null || !collectionChoices || isProcessing || problem) return;
        setIsProcessing(true);
        const result = await processCheckoutAction({
            requestKey: checkoutKey.current,
            items: cart.map(item => ({ id: item.id, quantity: item.cartQuantity, price: item.price, name: item.name, discountPercent: native ? item.discount || '0' : undefined })),
            paymentMethod: native ? paymentMethod : (paymentMethod === 'Transfer' ? 'Transfer' : 'Cash'),
            bankAccountId: native && ['Transfer', 'Split'].includes(paymentMethod) && bankAccountId ? bankAccountId : undefined,
            cashReceived: native && ['Cash', 'Split'].includes(paymentMethod) && cashReceived ? cashReceived : undefined,
            transferAmount: native && paymentMethod === 'Split' ? formatKobo(transferKobo) : undefined,
            customerId: native && paymentMethod === 'Credit' ? customerId : undefined,
            bookingId: bill?.id,
            jobId: job?.id,
            totalAmount: totalKobo / 100,
        });
        if (result.success) {
            setDone({ saleId: result.saleId, status: result.status, change: result.change, invoiceNumber: result.invoiceNumber, shortfalls: result.shortfalls });
            checkoutKey.current = crypto.randomUUID();
            setCart([]); setCashReceived(''); setTransferAmount(''); setCustomerId('');
            if (bill || job) { setBill(null); setJob(null); window.history.replaceState(null, '', '/pos'); }
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
                    <p className="text-muted-foreground mt-1">Prices come from your catalogue.{native && cap > 0 ? ` You can give up to ${cap}% off a line.` : ''}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => setParkedOpen(true)}>Parked sales ({parked.length})</Button>
                    {native && <Button asChild variant="outline"><Link href="/pos/sales">Sales and refunds</Link></Button>}
                </div>
            </div>

            {native && <ShiftBar banks={collectionChoices?.accounts ?? []} refreshKey={done?.saleId} onStatus={setShiftStatus} />}

            {job && <div role="status" className="rounded-xl border bg-card p-4 text-sm">
                <p className="font-semibold">Taking payment for {job.number ?? 'a job'}.</p>
                <p>Its materials already left stock when the job was completed.</p>
            </div>}
            {bill && <div role="status" className="rounded-xl border bg-card p-4 text-sm">
                <p className="font-semibold">Paying for {bill.customer_name || 'the customer'}&apos;s {bill.service ?? 'booking'}.</p>
                {depositKobo > 0 && <p>The {nairaText(depositKobo)} deposit paid earlier comes off the bill.</p>}
            </div>}

            {done && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <p className="font-semibold">{done.status === 'credit' ? `Credit sale recorded as invoice ${done.invoiceNumber}.`
                        : done.status === 'pending_payment' ? 'Sale recorded. The transfer is awaiting confirmation on Daily reconciliation.' : 'Sale recorded.'}</p>
                    {done.change && Number(done.change) > 0 && <p className="text-lg font-bold">Give change: ₦{Number(done.change).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</p>}
                    {done.shortfalls.length > 0 && <p>Sold more than recorded stock. The owner reviews this on Daily reconciliation.</p>}
                </div>
                <div className="flex gap-2">
                    {done.status !== 'credit' && <Button asChild size="sm"><Link href={`/pos/receipt/${done.saleId}`}>Receipt</Link></Button>}
                    <Button size="sm" variant="outline" onClick={() => setDone(null)}>Next sale</Button>
                </div>
            </div>}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 overflow-hidden">
                <Card className="lg:col-span-7 flex flex-col overflow-hidden border-primary/5">
                    <CardHeader className="pb-4">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input placeholder="Search inventory or scan SKU..." className="pl-10 h-11 rounded-xl shadow-sm border-primary/10"
                                value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                        </div>
                    </CardHeader>
                    <CardContent className="flex-1 overflow-hidden p-0">
                        <ScrollArea className="h-full px-6 pb-6">
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                                {filteredInventory.map((item) => (
                                    <button key={item.id} onClick={() => addToCart(item)}
                                        className={cn("group p-4 rounded-2xl border transition-all text-left flex flex-col gap-2 relative overflow-hidden",
                                            limitFor(item) > 0 ? "hover:border-primary hover:shadow-lg bg-card" : "bg-muted/50 opacity-60 cursor-not-allowed")}>
                                        <div className="flex justify-between items-start">
                                            <Badge variant={item.quantity && item.quantity > 5 ? 'secondary' : 'destructive'} className="text-[10px]">
                                                {item.type !== 'PRODUCT' ? 'Service' : item.track_stock === false ? 'Stock not tracked' : item.quantity && item.quantity > 0 ? `${item.quantity} In Stock` : 'Out of Stock'}
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
                        <CardTitle className="flex items-center gap-2"><ShoppingCart className="h-5 w-5 text-primary" />Active Cart</CardTitle>
                    </CardHeader>
                    <CardContent className="flex-1 overflow-hidden p-0">
                        {cart.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-30 gap-3">
                                <ShoppingCart className="h-16 w-16" /><p className="font-medium">Cart is empty</p>
                            </div>
                        ) : (
                            <ScrollArea className="h-full">
                                <div className="p-4 space-y-4">
                                    {lines.map(({ item, net }) => (
                                        <div key={item.id} className="flex flex-wrap items-center gap-3 bg-muted/20 p-3 rounded-xl border border-dashed">
                                            <div className="flex-1 min-w-[8rem]">
                                                <p className="font-bold text-sm">{item.name}</p>
                                                <p className="text-xs text-muted-foreground">₦{Number(item.price).toLocaleString()} each · {nairaText(net)}</p>
                                                {shortBy(item) > 0 && <p className="text-xs text-amber-700">{shortBy(item)} more than recorded stock</p>}
                                            </div>
                                            {native && cap > 0 && <label className="flex items-center gap-1 text-xs">
                                                <span className="sr-only">Discount for {item.name}</span>
                                                <Input aria-label={`Discount for ${item.name} (%)`} inputMode="decimal" className={cn("h-8 w-16 text-right", !validDiscount(item.discount, cap) && "border-destructive")}
                                                    value={item.discount} onChange={e => setDiscount(item.id, e.target.value)} />%
                                            </label>}
                                            <div className="flex items-center gap-3">
                                                <div className="flex items-center gap-1 bg-background border rounded-lg p-1">
                                                    <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={`One less ${item.name}`} onClick={() => updateCartQuantity(item.id, -1)}><Minus className="h-3 w-3" /></Button>
                                                    <span className="w-8 text-center text-xs font-bold">{item.cartQuantity}</span>
                                                    <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={`One more ${item.name}`} onClick={() => updateCartQuantity(item.id, 1)}><Plus className="h-3 w-3" /></Button>
                                                </div>
                                                <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" aria-label={`Remove ${item.name}`} onClick={() => setCart(cart.filter(i => i.id !== item.id))}>
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
                        <div className="w-full space-y-1">
                            {discountKobo > 0 && <div className="flex justify-between text-sm text-muted-foreground"><span>Discount</span><span>−{nairaText(discountKobo)}</span></div>}
                            <div className="flex justify-between items-center">
                                <span className="text-lg font-bold">Total Amount</span>
                                <span className="text-2xl font-bold font-headline text-primary">{nairaText(totalKobo)}</span>
                            </div>
                            {depositKobo > 0 && <>
                                <div className="flex justify-between text-sm text-muted-foreground"><span>Deposit paid earlier</span><span>−{nairaText(depositKobo)}</span></div>
                                <div className="flex justify-between font-bold"><span>To pay</span><span>{nairaText(Math.max(totalKobo - depositKobo, 0))}</span></div>
                            </>}
                        </div>

                        <Button variant="outline" className="w-full" disabled={cart.length === 0 || isProcessing} onClick={() => setParkOpen(true)}>Park sale</Button>
                        <Dialog open={isCheckoutOpen} onOpenChange={open => { if (!isProcessing) setIsCheckoutOpen(open); }}>
                            <DialogTrigger asChild>
                                <Button className="w-full h-14 rounded-xl text-lg font-bold shadow-lg shadow-primary/20" disabled={cart.length === 0 || badDiscount || needsShift}>Complete Checkout</Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-md">
                                <DialogHeader>
                                    <DialogTitle className="text-2xl">Payment</DialogTitle>
                                    <DialogDescription>Total {nairaText(totalKobo)}{discountKobo > 0 ? `, after ${nairaText(discountKobo)} discount` : ''}.{depositKobo > 0 ? ` To pay now: ${nairaText(totalKobo - depositKobo)}.` : ''}</DialogDescription>
                                </DialogHeader>
                                <div className="grid gap-4 py-2">
                                    {!collectionChoices ? <p role="alert">Payment accounts unavailable. Refresh to retry.</p>
                                        : !native ? <CollectionAccountPicker method={paymentMethod === 'Transfer' ? 'Transfer' : 'Cash'} bankAccountId={bankAccountId} choices={collectionChoices}
                                            onMethodChange={setPaymentMethod} onBankChange={setBankAccountId} disabled={isProcessing} />
                                        : <>
                                            <div role="radiogroup" aria-label="Payment method" className="grid grid-cols-2 gap-2">
                                                {METHODS.map(m => <Button key={m.value} type="button" role="radio" aria-checked={paymentMethod === m.value} disabled={isProcessing}
                                                    variant={paymentMethod === m.value ? 'default' : 'outline'} onClick={() => setPaymentMethod(m.value)}>{m.label}</Button>)}
                                            </div>
                                            {paymentMethod === 'Split' && <label className="space-y-1 text-sm"><span>Paid by transfer (₦)</span>
                                                <Input inputMode="decimal" value={transferAmount} disabled={isProcessing} onChange={e => setTransferAmount(e.target.value)} />
                                                {transferKobo > 0 && transferKobo < totalKobo && <span className="block text-muted-foreground">Cash due: {nairaText(totalKobo - transferKobo)}</span>}
                                            </label>}
                                            {['Cash', 'Split'].includes(paymentMethod) && <label className="space-y-1 text-sm"><span>Cash received (₦, optional)</span>
                                                <Input inputMode="decimal" value={cashReceived} disabled={isProcessing} onChange={e => setCashReceived(e.target.value)} />
                                                {change !== null && <span className="block font-semibold">Change: {nairaText(change)}</span>}
                                            </label>}
                                            {['Transfer', 'Split'].includes(paymentMethod) && <>
                                                <label className="space-y-1 text-sm"><span>Bank account you expect it in (optional)</span>
                                                    <select className="h-11 w-full rounded-md border bg-background px-3" value={bankAccountId} disabled={isProcessing} onChange={e => setBankAccountId(e.target.value)}>
                                                        <option value="">Not sure yet: choose when confirming</option>
                                                        {collectionChoices.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                                                    </select>
                                                </label>
                                                <p className="text-sm text-muted-foreground">The transfer waits for confirmation on Daily reconciliation before it counts as money in the bank.</p>
                                            </>}
                                            {paymentMethod === 'Credit' && <label className="space-y-1 text-sm"><span>Customer who owes</span>
                                                <select className="h-11 w-full rounded-md border bg-background px-3" value={customerId} disabled={isProcessing} onChange={e => setCustomerId(e.target.value)}>
                                                    <option value="">Choose a customer</option>
                                                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                                </select>
                                                <span className="block text-muted-foreground">Recorded as an invoice they pay later. Add new customers in Customers.</span>
                                            </label>}
                                        </>}
                                    {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
                                </div>
                                <DialogFooter>
                                    <Button className="w-full h-12 text-lg" onClick={handleCheckout} disabled={isProcessing || !collectionChoices || !!problem}>
                                        {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Confirm & Record Sale"}
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </CardFooter>
                </Card>
            </div>

            <Dialog open={parkOpen} onOpenChange={open => { if (!parking) setParkOpen(open); }}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader><DialogTitle>Park this sale</DialogTitle>
                        <DialogDescription>Save the cart to finish later, for example while the customer fetches money. Nothing is recorded until checkout.</DialogDescription></DialogHeader>
                    <label className="space-y-1 text-sm"><span>Name (optional)</span>
                        <Input maxLength={60} value={parkLabel} disabled={parking} placeholder="For example: Ada, blue cap" onChange={e => setParkLabel(e.target.value)} /></label>
                    <DialogFooter><Button className="w-full" disabled={parking} onClick={() => void parkSale()}>{parking ? 'Parking…' : 'Park sale'}</Button></DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={parkedOpen} onOpenChange={setParkedOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader><DialogTitle>Parked sales</DialogTitle>
                        <DialogDescription>{cart.length > 0 ? 'Finish or park the current cart before resuming another.' : 'Prices are read again from your catalogue when you resume.'}</DialogDescription></DialogHeader>
                    {parked.length === 0 ? <p className="text-sm text-muted-foreground">No parked sales.</p> : <ul className="space-y-2 text-sm">
                        {parked.map(p => <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
                            <span><span className="font-medium">{p.label || 'Parked sale'}</span>
                                <span className="block text-muted-foreground">{p.items.reduce((n, i) => n + i.quantity, 0)} items, parked {new Date(p.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}</span></span>
                            <span className="flex gap-2">
                                <Button size="sm" disabled={cart.length > 0} onClick={() => void takeParked(p, true)}>Resume</Button>
                                <Button size="sm" variant="outline" onClick={() => { if (window.confirm('Discard this parked sale?')) void takeParked(p, false); }}>Discard</Button>
                            </span>
                        </li>)}
                    </ul>}
                </DialogContent>
            </Dialog>
        </div>
    )
}
