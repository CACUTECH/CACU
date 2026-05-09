
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
    Share2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export default function StorefrontPage() {
    const { toast } = useToast();
    const [isLive, setIsLive] = React.useState(true);
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
                    <h1 className="font-headline text-3xl font-bold tracking-tight">Digital Storefront</h1>
                    <p className="text-muted-foreground mt-1">
                        Manage your online shop and digital presence.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={copyUrl}>
                        <Copy className="mr-2 h-4 w-4" />
                        Copy Link
                    </Button>
                    <Button asChild>
                        <Link href="#" target="_blank">
                            <ExternalLink className="mr-2 h-4 w-4" />
                            View Store
                        </Link>
                    </Button>
                </div>
            </div>

            {/* Store Status Banner */}
            <Card className={cn(
                "border-none shadow-md",
                isLive ? "bg-emerald-500/10" : "bg-muted"
            )}>
                <CardContent className="flex items-center justify-between p-6">
                    <div className="flex items-center gap-4">
                        <div className={cn(
                            "p-3 rounded-full",
                            isLive ? "bg-emerald-500 text-white" : "bg-muted-foreground/20 text-muted-foreground"
                        )}>
                            <Store className="h-6 w-6" />
                        </div>
                        <div>
                            <p className="font-bold text-lg">{isLive ? "Your store is currently LIVE" : "Your store is OFFLINE"}</p>
                            <p className="text-sm text-muted-foreground">Customers can {isLive ? "browse and buy" : "not access"} your catalog at {storeUrl}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Label htmlFor="store-toggle" className="text-sm font-medium">Toggle Status</Label>
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
                </CardContent>
            </Card>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Store Views</CardTitle>
                        <Eye className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">1,284</div>
                        <p className="text-xs text-green-600 font-medium">+12% from last week</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Online Orders</CardTitle>
                        <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">42</div>
                        <p className="text-xs text-green-600 font-medium">₦184,200 total value</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Avg. Order Value</CardTitle>
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">₦4,385</div>
                        <p className="text-xs text-muted-foreground">-2% from last week</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Catalog Items</CardTitle>
                        <Package className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">124</div>
                        <p className="text-xs text-muted-foreground">85% in stock</p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                {/* Customization & Design */}
                <Card className="flex flex-col h-full">
                    <CardHeader>
                        <div className="bg-primary/10 w-fit p-2 rounded-lg mb-2">
                            <Palette className="h-5 w-5 text-primary" />
                        </div>
                        <CardTitle>Theme & Appearance</CardTitle>
                        <CardDescription>Customize the look and feel of your online shop to match your brand.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow space-y-4">
                        <div className="p-4 rounded-xl border border-dashed flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded bg-primary" />
                                <div>
                                    <p className="text-sm font-bold">Modern Professional</p>
                                    <p className="text-xs text-muted-foreground">Currently active theme</p>
                                </div>
                            </div>
                            <Button variant="ghost" size="sm">Change</Button>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <p className="text-xs font-medium">Brand Color</p>
                                <div className="flex gap-2">
                                    <div className="h-6 w-6 rounded-full bg-indigo-600 cursor-pointer border-2 border-white ring-1 ring-black/10" />
                                    <div className="h-6 w-6 rounded-full bg-emerald-600 cursor-pointer" />
                                    <div className="h-6 w-6 rounded-full bg-amber-600 cursor-pointer" />
                                </div>
                            </div>
                            <div className="space-y-1">
                                <p className="text-xs font-medium">Typography</p>
                                <Badge variant="outline">Inter & Space Grotesk</Badge>
                            </div>
                        </div>
                    </CardContent>
                    <CardFooter className="pt-0">
                        <Button className="w-full" variant="outline">
                            Customize Theme <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                    </CardFooter>
                </Card>

                {/* Domain & SEO */}
                <Card className="flex flex-col h-full">
                    <CardHeader>
                        <div className="bg-primary/10 w-fit p-2 rounded-lg mb-2">
                            <Globe className="h-5 w-5 text-primary" />
                        </div>
                        <CardTitle>Domain & SEO</CardTitle>
                        <CardDescription>Manage your store address and how you appear in search results.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow space-y-4">
                        <div className="space-y-2">
                            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Current Domain</p>
                            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border">
                                <span className="text-sm font-mono">{storeUrl}</span>
                                <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20">SSL Active</Badge>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 p-3 bg-primary/5 rounded-lg border border-primary/10">
                            <Smartphone className="h-4 w-4 text-primary shrink-0" />
                            <p className="text-xs text-muted-foreground">Mobile performance is optimized for 2G/3G networks in Nigeria.</p>
                        </div>
                    </CardContent>
                    <CardFooter className="pt-0">
                        <Button className="w-full" variant="outline">
                            Link Custom Domain <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                    </CardFooter>
                </Card>
            </div>

            {/* Quick Setup Checklist */}
            <Card>
                <CardHeader>
                    <CardTitle className="font-headline">Setup Checklist</CardTitle>
                    <CardDescription>Complete these steps to optimize your storefront for more sales.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        <div className="flex items-start gap-3 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
                            <CircleCheck className="h-5 w-5 text-emerald-500 mt-0.5" />
                            <div>
                                <p className="text-sm font-bold">Add at least 5 products</p>
                                <p className="text-xs text-muted-foreground">Help customers find what they need with a good variety.</p>
                            </div>
                        </div>
                        <div className="flex items-start gap-3 p-3 rounded-lg border">
                            <div className="h-5 w-5 rounded-full border-2 border-primary/20 mt-0.5" />
                            <div className="flex-grow">
                                <p className="text-sm font-bold">Set up WhatsApp Checkout</p>
                                <p className="text-xs text-muted-foreground">Allow customers to send their cart directly to your WhatsApp Business.</p>
                            </div>
                            <Button size="sm" variant="ghost">Setup</Button>
                        </div>
                        <div className="flex items-start gap-3 p-3 rounded-lg border">
                            <div className="h-5 w-5 rounded-full border-2 border-primary/20 mt-0.5" />
                            <div className="flex-grow">
                                <p className="text-sm font-bold">Configure Shipping Rates</p>
                                <p className="text-xs text-muted-foreground">Add delivery zones for major cities like Lagos, Abuja, and Port Harcourt.</p>
                            </div>
                            <Button size="sm" variant="ghost">Manage</Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card className="bg-primary border-none shadow-xl shadow-primary/20">
                <CardContent className="p-8 text-primary-foreground text-center">
                    <h3 className="font-headline text-2xl font-bold mb-2">Promote Your Shop</h3>
                    <p className="text-primary-foreground/80 mb-6 max-w-lg mx-auto">
                        Share your storefront on social media to start accepting orders directly. No commission fees on CACU storefronts.
                    </p>
                    <div className="flex flex-wrap justify-center gap-4">
                        <Button variant="secondary" className="bg-white text-primary hover:bg-white/90">
                            <Share2 className="mr-2 h-4 w-4" /> Share to Instagram
                        </Button>
                        <Button variant="secondary" className="bg-white text-primary hover:bg-white/90">
                            <Share2 className="mr-2 h-4 w-4" /> Share to WhatsApp
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

function cn(...inputs: any[]) {
    return inputs.filter(Boolean).join(" ");
}
