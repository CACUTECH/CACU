"use client";

import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
    Store, 
    Globe, 
    Palette, 
    ShoppingCart, 
    ExternalLink, 
    Smartphone, 
    Eye, 
    TrendingUp, 
    ArrowRight,
    CircleCheck,
    Settings,
    Copy,
    Share2,
    Package,
    MessageCircle,
    LayoutDashboard,
    Image as ImageIcon,
    Truck,
    CheckCircle2,
    Loader2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { catalogItems as initialCatalog } from "@/lib/data";
import { Separator } from "@/components/ui/separator";

export default function StorefrontPage() {
    const { toast } = useToast();
    const [isLive, setIsLive] = React.useState(true);
    const [activeTab, setActiveTab] = React.useState("overview");
    const [isSaving, setIsSaving] = React.useState(false);
    const storeUrl = "https://cacu.store/my-business";

    // Form States
    const [storeInfo, setStoreInfo] = React.useState({
        name: "CACU Technologies Shop",
        email: "sales@yourbusiness.com",
        bio: "Providing high-quality goods and professional services to Lagos and beyond.",
        whatsapp: "+234 800 000 0000",
        whatsappEnabled: true
    });

    const [design, setDesign] = React.useState({
        primaryColor: "indigo",
        heroHeadline: "Welcome to our official store",
        ctaText: "Shop Now"
    });

    const [visibleProducts, setVisibleProducts] = React.useState<Record<string, boolean>>(
        initialCatalog.reduce((acc, item) => ({ ...acc, [item.id]: true }), {})
    );

    const copyUrl = () => {
        navigator.clipboard.writeText(storeUrl);
        toast({
            title: "URL Copied",
            description: "Storefront link copied to clipboard.",
        });
    };

    const handleSaveSetup = () => {
        setIsSaving(true);
        setTimeout(() => {
            setIsSaving(false);
            toast({
                title: "Storefront Updated",
                description: "Your core information and checkout settings have been saved.",
            });
        }, 800);
    };

    const toggleProductVisibility = (id: string) => {
        setVisibleProducts(prev => ({ ...prev, [id]: !prev[id] }));
        toast({
            title: visibleProducts[id] ? "Hidden from Store" : "Visible in Store",
            description: `Product visibility status updated.`,
        });
    };

    const handleShare = (platform: string) => {
        toast({
            title: `Sharing to ${platform}`,
            description: "Generating your store preview link...",
        });
    };

    const handleGrowthTools = () => {
        toast({
            title: "Growth Tools Module",
            description: "Opening SEO and Pixel configuration suite...",
        });
    };

    return (
        <div className="flex flex-col gap-8 pb-12">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">Storefront Management</h1>
                    <p className="text-muted-foreground mt-1">
                        Configure your online presence and direct-to-customer sales channel.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={copyUrl} className="rounded-xl">
                        <Copy className="mr-2 h-4 w-4" />
                        Copy Link
                    </Button>
                    <Button asChild className="rounded-xl shadow-lg shadow-primary/20">
                        <Link href="#" target="_blank">
                            <ExternalLink className="mr-2 h-4 w-4" />
                            View Store
                        </Link>
                    </Button>
                </div>
            </div>

            {/* Store Status Banner */}
            <Card className={cn(
                "border-none shadow-md overflow-hidden relative",
                isLive ? "bg-emerald-500/10" : "bg-muted"
            )}>
                <div className="absolute top-0 right-0 p-4">
                    <div className="flex items-center gap-2">
                        <Label htmlFor="store-toggle" className="text-xs font-bold uppercase tracking-widest">Store Status</Label>
                        <Switch 
                            id="store-toggle" 
                            checked={isLive} 
                            onCheckedChange={(val) => {
                                setIsLive(val);
                                toast({
                                    title: val ? "Store Published" : "Store Taken Offline",
                                    description: val ? "Your catalog is now visible to customers." : "Customers will see a maintenance page.",
                                });
                            }} 
                        />
                    </div>
                </div>
                <CardContent className="flex items-center gap-4 p-6">
                    <div className={cn(
                        "p-4 rounded-2xl",
                        isLive ? "bg-emerald-500 text-white" : "bg-muted-foreground/20 text-muted-foreground"
                    )}>
                        <Store className="h-8 w-8" />
                    </div>
                    <div>
                        <p className="font-bold text-lg">{isLive ? "Your store is currently LIVE" : "Your store is OFFLINE"}</p>
                        <p className="text-sm text-muted-foreground">URL: <span className="font-mono text-primary underline">{storeUrl}</span></p>
                    </div>
                </CardContent>
            </Card>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4 h-auto p-1 bg-primary/5 border border-primary/10 shadow-xl shadow-primary/5 rounded-xl mb-8">
                    <TabsTrigger value="overview" className="py-2.5 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-white transition-all shadow-sm">
                        <LayoutDashboard className="w-4 h-4 mr-2" /> Overview
                    </TabsTrigger>
                    <TabsTrigger value="setup" className="py-2.5 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-white transition-all shadow-sm">
                        <Settings className="w-4 h-4 mr-2" /> Store Setup
                    </TabsTrigger>
                    <TabsTrigger value="design" className="py-2.5 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-white transition-all shadow-sm">
                        <Palette className="w-4 h-4 mr-2" /> Design
                    </TabsTrigger>
                    <TabsTrigger value="products" className="py-2.5 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-white transition-all shadow-sm">
                        <Package className="w-4 h-4 mr-2" /> Product Manager
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-6">
                    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                        <SummaryCard title="Store Views" value="1,284" subtext="+12% from last week" icon={Eye} />
                        <SummaryCard title="Online Orders" value="42" subtext="₦184,200 total value" icon={ShoppingCart} />
                        <SummaryCard title="Avg. Order Value" value="₦4,385" subtext="-2% from last week" icon={TrendingUp} />
                        <SummaryCard title="Live Items" value={Object.values(visibleProducts).filter(v => v).length.toString()} subtext="Active on storefront" icon={Package} />
                    </div>

                    <div className="grid gap-6 md:grid-cols-2">
                        <Card>
                            <CardHeader>
                                <CardTitle>Setup Checklist</CardTitle>
                                <CardDescription>Boost your sales by completing your profile.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <ChecklistItem label="Add Business Logo" completed={true} onAction={() => setActiveTab("design")} />
                                <ChecklistItem label="Configure WhatsApp Checkout" completed={true} onAction={() => setActiveTab("setup")} />
                                <ChecklistItem label="Set Shipping Rates" completed={false} onAction={() => toast({ title: "Module Locked", description: "Shipping module setup coming in next update." })} />
                                <ChecklistItem label="Link Custom Domain" completed={false} onAction={() => toast({ title: "Custom Domain", description: "Contact support to link a custom .com or .ng domain." })} />
                            </CardContent>
                        </Card>
                        <Card className="bg-primary/5 border-dashed border-2 flex flex-col justify-center p-6 text-center">
                            <h3 className="font-headline text-xl font-bold text-primary">Need more customers?</h3>
                            <p className="text-sm text-muted-foreground mt-2 mb-6">
                                Enable SEO optimization and social media pixel tracking to reach thousands of buyers in Nigeria.
                            </p>
                            <Button variant="outline" className="w-fit mx-auto border-primary/20 text-primary hover:bg-primary/10" onClick={handleGrowthTools}>
                                Configure Growth Tools
                            </Button>
                        </Card>
                    </div>
                </TabsContent>

                <TabsContent value="setup" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Core Information</CardTitle>
                            <CardDescription>This information is visible to your customers.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-2">
                                    <Label>Store Display Name</Label>
                                    <Input 
                                        value={storeInfo.name} 
                                        onChange={(e) => setStoreInfo({ ...storeInfo, name: e.target.value })} 
                                        placeholder="e.g. CACU Technologies Shop" 
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Support Email</Label>
                                    <Input 
                                        value={storeInfo.email} 
                                        onChange={(e) => setStoreInfo({ ...storeInfo, email: e.target.value })} 
                                        placeholder="sales@yourbusiness.com" 
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>Store Bio / About</Label>
                                <Textarea 
                                    value={storeInfo.bio} 
                                    onChange={(e) => setStoreInfo({ ...storeInfo, bio: e.target.value })} 
                                    placeholder="Tell your customers what you do..." 
                                    className="min-h-[100px]" 
                                />
                            </div>
                            
                            <Separator />

                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <Label className="text-base font-bold flex items-center gap-2">
                                            <MessageCircle className="h-5 w-5 text-emerald-500" />
                                            WhatsApp Business Checkout
                                        </Label>
                                        <p className="text-sm text-muted-foreground">Customers can send orders directly to your WhatsApp.</p>
                                    </div>
                                    <Switch 
                                        checked={storeInfo.whatsappEnabled} 
                                        onCheckedChange={(val) => setStoreInfo({ ...storeInfo, whatsappEnabled: val })} 
                                    />
                                </div>
                                <div className="grid gap-4 max-w-md">
                                    <div className="space-y-2">
                                        <Label>WhatsApp Number</Label>
                                        <Input 
                                            value={storeInfo.whatsapp} 
                                            onChange={(e) => setStoreInfo({ ...storeInfo, whatsapp: e.target.value })} 
                                            placeholder="+234 800 000 0000" 
                                            disabled={!storeInfo.whatsappEnabled}
                                        />
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                        <CardFooter className="border-t bg-muted/20 py-6">
                            <Button onClick={handleSaveSetup} disabled={isSaving}>
                                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Save Changes
                            </Button>
                        </CardFooter>
                    </Card>
                </TabsContent>

                <TabsContent value="design" className="space-y-6">
                    <div className="grid gap-6 md:grid-cols-2">
                        <Card>
                            <CardHeader>
                                <CardTitle>Branding & Colors</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="space-y-2">
                                    <Label>Brand Identity (Logo)</Label>
                                    <div className="flex items-center gap-4">
                                        <div className="h-16 w-16 rounded-xl border-2 border-dashed bg-muted flex items-center justify-center">
                                            <ImageIcon className="h-6 w-6 text-muted-foreground" />
                                        </div>
                                        <Button variant="outline" size="sm" onClick={() => toast({ title: "Upload Triggered", description: "Choose a file from your device." })}>Upload Logo</Button>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label>Primary Color Theme</Label>
                                    <div className="flex gap-3">
                                        {[
                                            { name: "indigo", bg: "bg-indigo-600" },
                                            { name: "emerald", bg: "bg-emerald-600" },
                                            { name: "amber", bg: "bg-amber-600" },
                                            { name: "rose", bg: "bg-rose-600" }
                                        ].map((c) => (
                                            <button
                                                key={c.name}
                                                onClick={() => setDesign({ ...design, primaryColor: c.name })}
                                                className={cn(
                                                    "h-10 w-10 rounded-full transition-all ring-offset-2",
                                                    c.bg,
                                                    design.primaryColor === c.name ? "ring-2 ring-primary scale-110" : "hover:scale-105 opacity-80"
                                                )}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader>
                                <CardTitle>Hero Section</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Hero Headline</Label>
                                    <Input 
                                        value={design.heroHeadline} 
                                        onChange={(e) => setDesign({ ...design, heroHeadline: e.target.value })} 
                                        placeholder="Welcome to our official store" 
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Call to Action Button</Label>
                                    <Input 
                                        value={design.ctaText} 
                                        onChange={(e) => setDesign({ ...design, ctaText: e.target.value })} 
                                        placeholder="Shop Now" 
                                    />
                                </div>
                                <Button className="w-full mt-4" onClick={() => toast({ title: "Design Saved" })}>Update Store Appearance</Button>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                <TabsContent value="products" className="space-y-6">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle>Product Visibility</CardTitle>
                                <CardDescription>Toggle which inventory items are visible to customers online.</CardDescription>
                            </div>
                            <Button asChild variant="outline" size="sm">
                                <Link href="/catalog">Manage Inventory</Link>
                            </Button>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="divide-y">
                                {initialCatalog.filter(i => i.type === 'Product').map((item) => (
                                    <div key={item.id} className="flex items-center justify-between p-4 px-6 hover:bg-muted/10 transition-colors">
                                        <div className="flex items-center gap-4">
                                            <div className="h-10 w-10 rounded-lg bg-primary/5 flex items-center justify-center">
                                                <Package className="h-5 w-5 text-primary" />
                                            </div>
                                            <div>
                                                <p className="font-bold text-sm">{item.name}</p>
                                                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">SKU: {item.sku}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-6">
                                            <div className="text-right">
                                                <p className="text-sm font-bold">₦{item.price.toLocaleString()}</p>
                                                <Badge variant="outline" className="text-[9px]">{item.status}</Badge>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Label className="text-[10px] uppercase font-bold text-muted-foreground">Visible</Label>
                                                <Switch 
                                                    checked={!!visibleProducts[item.id]} 
                                                    onCheckedChange={() => toggleProductVisibility(item.id)}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            <Card className="bg-primary text-primary-foreground border-none shadow-2xl shadow-primary/20">
                <CardContent className="p-8 text-center flex flex-col items-center gap-4">
                    <div className="bg-white/20 p-3 rounded-full">
                        <Share2 className="h-6 w-6" />
                    </div>
                    <h3 className="font-headline text-2xl font-bold">Promote Your Digital Shop</h3>
                    <p className="text-white/80 max-w-lg">
                        You can now share your store directly on social media. Orders will populate in your "Invoices" and "Transactions" sections automatically.
                    </p>
                    <div className="flex flex-wrap justify-center gap-3">
                        <Button variant="secondary" className="bg-white text-primary hover:bg-white/90 font-bold px-6" onClick={() => handleShare("Instagram")}>
                            Share to Instagram
                        </Button>
                        <Button variant="secondary" className="bg-white text-primary hover:bg-white/90 font-bold px-6" onClick={() => handleShare("WhatsApp")}>
                            Share to WhatsApp
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

function SummaryCard({ title, value, subtext, icon: Icon }: { title: string, value: string, subtext: string, icon: any }) {
    return (
        <Card className="hover:shadow-md transition-shadow border-primary/5">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</CardTitle>
                <div className="bg-primary/10 p-2 rounded-lg">
                    <Icon className="h-4 w-4 text-primary" />
                </div>
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold font-headline">{value}</div>
                <p className={cn(
                    "text-[10px] font-medium mt-1",
                    subtext.startsWith('+') ? "text-emerald-600" : "text-muted-foreground"
                )}>{subtext}</p>
            </CardContent>
        </Card>
    );
}

function ChecklistItem({ label, completed, onAction }: { label: string, completed: boolean, onAction: () => void }) {
    return (
        <div className="flex items-center gap-3 p-3 rounded-xl border bg-muted/10">
            {completed ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
            ) : (
                <div className="h-5 w-5 rounded-full border-2 border-primary/20 shrink-0" />
            )}
            <span className={cn("text-sm font-medium", completed && "text-muted-foreground line-through")}>{label}</span>
            <Button variant="ghost" size="sm" className="ml-auto text-[10px] font-bold text-primary uppercase tracking-widest" onClick={onAction}>
                {completed ? "Edit" : "Setup"}
            </Button>
        </div>
    );
}
