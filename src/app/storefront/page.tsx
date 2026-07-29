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
    CheckCircle2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { catalogItems } from "@/lib/data";
import { Separator } from "@/components/ui/separator";

export default function StorefrontPage() {
    const { toast } = useToast();
    const [isLive, setIsLive] = React.useState(true);
    const [activeTab, setActiveTab] = React.useState("overview");
    const storeUrl = "https://cacu.store/my-business";

    const copyUrl = () => {
        navigator.clipboard.writeText(storeUrl);
        toast({
            title: "URL Copied",
            description: "Storefront link copied to clipboard.",
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
                        <SummaryCard title="Live Items" value="18" subtext="Active on storefront" icon={Package} />
                    </div>

                    <div className="grid gap-6 md:grid-cols-2">
                        <Card>
                            <CardHeader>
                                <CardTitle>Setup Checklist</CardTitle>
                                <CardDescription>Boost your sales by completing your profile.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <ChecklistItem label="Add Business Logo" completed={true} />
                                <ChecklistItem label="Configure WhatsApp Checkout" completed={true} />
                                <ChecklistItem label="Set Shipping Rates" completed={false} />
                                <ChecklistItem label="Link Custom Domain" completed={false} />
                            </CardContent>
                        </Card>
                        <Card className="bg-primary/5 border-dashed border-2 flex flex-col justify-center p-6 text-center">
                            <h3 className="font-headline text-xl font-bold text-primary">Need more customers?</h3>
                            <p className="text-sm text-muted-foreground mt-2 mb-6">
                                Enable SEO optimization and social media pixel tracking to reach thousands of buyers in Nigeria.
                            </p>
                            <Button variant="outline" className="w-fit mx-auto border-primary/20 text-primary hover:bg-primary/10">
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
                                    <Input placeholder="e.g. CACU Technologies Shop" />
                                </div>
                                <div className="space-y-2">
                                    <Label>Support Email</Label>
                                    <Input placeholder="sales@yourbusiness.com" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>Store Bio / About</Label>
                                <Textarea placeholder="Tell your customers what you do..." className="min-h-[100px]" />
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
                                    <Switch defaultChecked />
                                </div>
                                <div className="grid gap-4 max-w-md">
                                    <div className="space-y-2">
                                        <Label>WhatsApp Number</Label>
                                        <Input placeholder="+234 800 000 0000" />
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                        <CardFooter className="border-t bg-muted/20 py-6">
                            <Button onClick={() => toast({ title: "Configuration Saved" })}>Save Changes</Button>
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
                                        <Button variant="outline" size="sm">Upload Logo</Button>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label>Primary Color</Label>
                                    <div className="flex gap-3">
                                        <div className="h-8 w-8 rounded-full bg-indigo-600 ring-2 ring-primary ring-offset-2 cursor-pointer" />
                                        <div className="h-8 w-8 rounded-full bg-emerald-600 cursor-pointer" />
                                        <div className="h-8 w-8 rounded-full bg-amber-600 cursor-pointer" />
                                        <div className="h-8 w-8 rounded-full bg-red-600 cursor-pointer" />
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
                                    <Input placeholder="Welcome to our official store" />
                                </div>
                                <div className="space-y-2">
                                    <Label>Call to Action Button</Label>
                                    <Input placeholder="Shop Now" />
                                </div>
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
                                {catalogItems.filter(i => i.type === 'Product').map((item) => (
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
                                                <Switch defaultChecked />
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
                        <Button variant="secondary" className="bg-white text-primary hover:bg-white/90 font-bold px-6">
                            Share to Instagram
                        </Button>
                        <Button variant="secondary" className="bg-white text-primary hover:bg-white/90 font-bold px-6">
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

function ChecklistItem({ label, completed }: { label: string, completed: boolean }) {
    return (
        <div className="flex items-center gap-3 p-3 rounded-xl border bg-muted/10">
            {completed ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
            ) : (
                <div className="h-5 w-5 rounded-full border-2 border-primary/20 shrink-0" />
            )}
            <span className={cn("text-sm font-medium", completed && "text-muted-foreground line-through")}>{label}</span>
            {!completed && <Button variant="ghost" size="sm" className="ml-auto text-[10px] font-bold text-primary uppercase tracking-widest">Setup</Button>}
        </div>
    );
}