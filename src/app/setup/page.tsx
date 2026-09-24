"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { Loader2, UploadCloud, Briefcase, Package, Sparkles } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { doc, writeBatch, serverTimestamp } from "firebase/firestore";
import { useFirestore, useUser } from "@/firebase";
import { createBusinessAction } from "./actions";

const formSchema = z.object({
  businessName: z.string().min(1, "Business name is required"),
  businessType: z.enum(['PRODUCT', 'SERVICE', 'HYBRID'], {
    required_error: "Please select a business type",
  }),
  businessSector: z.string().min(1, "Business sector is required"),
  businessAddress: z.string().min(1, "Business address is required"),
  businessEmail: z.string().email(),
  phoneNumber: z.string().min(1, "Phone number is required"),
  bankName: z.string().min(1, "Bank name is required"),
  accountNumber: z.string().min(1, "Account number is required"),
  accountName: z.string().min(1, "Account name is required"),
});

export default function SetupPage() {
  const { toast } = useToast();
  const router = useRouter();
  const db = useFirestore();
  const { user, loading: userLoading } = useUser();
  const [isLoading, setIsLoading] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!userLoading && !user) {
      router.push("/login");
    }
  }, [user, userLoading, router]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      businessName: "",
      businessType: 'HYBRID',
      businessSector: "",
      businessAddress: "",
      businessEmail: "",
      phoneNumber: "",
      bankName: "",
      accountNumber: "",
      accountName: "",
    },
  });

  const handleLogoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setLogoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!user) return;
    setIsLoading(true);
    
    try {
      // P0 FIX: Perform atomic provisioning via batch write
      const businessId = user.uid;
      const batch = writeBatch(db);
      
      const setupResult = await createBusinessAction({
        businessId,
        ownerUid: user.uid,
        name: values.businessName,
        type: values.businessType,
        sector: values.businessSector,
        address: values.businessAddress,
        email: values.businessEmail,
        phone: values.phoneNumber,
        bank: {
          name: values.bankName,
          number: values.accountNumber,
          accountName: values.accountName,
        }
      });

      if (setupResult.success) {
        const businessRef = doc(db, "businesses", businessId);
        const userRef = doc(db, "businesses", businessId, "users", user.uid);

        batch.set(businessRef, {
          ...setupResult.businessData,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        batch.set(userRef, {
          ...setupResult.userData,
          createdAt: serverTimestamp(),
        });

        await batch.commit();

        localStorage.setItem('business-type', values.businessType);
        toast({
          title: "Business Launched",
          description: `Security claims and profile initialized for ${values.businessName}.`,
        });
        router.push("/");
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Setup Failed",
        description: error.message || "Failed to provision business tenant.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (userLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="flex items-center justify-center min-h-screen bg-muted/40 px-4 py-12">
      <div className="w-full max-w-2xl mx-auto">
        <Card className="shadow-2xl border-primary/5">
          <CardHeader className="text-center">
            <CardTitle className="text-3xl font-headline">Welcome to CACU</CardTitle>
            <CardDescription>Configure your secure business environment</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                 <div className="space-y-2">
                  <FormLabel>Business Logo</FormLabel>
                  <div className="flex items-center gap-6">
                    <div className="w-24 h-24 rounded-2xl border-2 border-dashed flex items-center justify-center bg-muted/50 overflow-hidden">
                      {logoPreview ? (
                        <Image src={logoPreview} alt="Logo Preview" width={96} height={96} className="object-contain" />
                      ) : (
                        <UploadCloud className="h-8 w-8 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1">
                      <Input id="logo-upload" type="file" onChange={handleLogoChange} accept="image/*" className="hidden" />
                      <Button type="button" variant="outline" onClick={() => document.getElementById('logo-upload')?.click()}>
                        Upload Identity
                      </Button>
                      <p className="text-[10px] text-muted-foreground mt-2 uppercase font-bold tracking-widest">PNG or JPG. Max 2MB.</p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-6">
                    <FormField
                        control={form.control}
                        name="businessName"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Legal Business Name</FormLabel>
                                <FormControl>
                                    <Input placeholder="e.g. Acme Services Ltd" disabled={isLoading} {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <FormField
                        control={form.control}
                        name="businessType"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>What do you sell?</FormLabel>
                                <div className="grid grid-cols-3 gap-4 mt-2">
                                    {[
                                        { val: 'PRODUCT', label: 'Products', icon: Package, desc: 'Retail, Wholesale' },
                                        { val: 'SERVICE', label: 'Services', icon: Briefcase, desc: 'Consulting, Repairs' },
                                        { val: 'HYBRID', label: 'Hybrid', icon: Sparkles, desc: 'Both goods & work' },
                                    ].map((type) => (
                                        <button
                                            key={type.val}
                                            type="button"
                                            disabled={isLoading}
                                            onClick={() => field.onChange(type.val)}
                                            className={cn(
                                                "flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-center",
                                                field.value === type.val 
                                                    ? "border-primary bg-primary/5 shadow-lg shadow-primary/10" 
                                                    : "border-muted bg-card hover:border-primary/50"
                                            )}
                                        >
                                            <type.icon className={cn("h-6 w-6", field.value === type.val ? "text-primary" : "text-muted-foreground")} />
                                            <div>
                                                <p className="text-sm font-bold">{type.label}</p>
                                                <p className="text-[10px] text-muted-foreground">{type.desc}</p>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField
                        control={form.control}
                        name="businessSector"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Industry Sector</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isLoading}>
                                    <FormControl>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select industry" />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        <SelectItem value="it">Technology & IT</SelectItem>
                                        <SelectItem value="legal">Legal & Professional</SelectItem>
                                        <SelectItem value="beauty">Salon & Beauty</SelectItem>
                                        <SelectItem value="auto">Automotive & Repair</SelectItem>
                                        <SelectItem value="retail">Retail & Shop</SelectItem>
                                        <SelectItem value="other">Other Services</SelectItem>
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="phoneNumber"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Business Phone</FormLabel>
                                <FormControl>
                                    <Input placeholder="+234..." disabled={isLoading} {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <FormField
                    control={form.control}
                    name="businessEmail"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Public Business Email</FormLabel>
                            <FormControl>
                                <Input placeholder="sales@yourbiz.com" disabled={isLoading} {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="businessAddress"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Physical Address</FormLabel>
                            <FormControl>
                                <Input placeholder="Headquarters location" disabled={isLoading} {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <Separator />
                
                <div className="space-y-4">
                    <div>
                        <h3 className="text-lg font-bold font-headline">Settlement Details</h3>
                        <p className="text-xs text-muted-foreground">Bank info for invoices and online payouts.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <FormField
                            control={form.control}
                            name="bankName"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Bank Name</FormLabel>
                                    <FormControl>
                                        <Input placeholder="e.g. Sterling Bank" disabled={isLoading} {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="accountNumber"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Account Number</FormLabel>
                                    <FormControl>
                                        <Input placeholder="0123456789" disabled={isLoading} {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                    <FormField
                        control={form.control}
                        name="accountName"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Beneficiary Name</FormLabel>
                                <FormControl>
                                    <Input placeholder="Registered business name" disabled={isLoading} {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <Button 
                  type="submit" 
                  className="w-full h-14 text-lg rounded-xl shadow-xl shadow-primary/20"
                  disabled={isLoading}
                >
                  {isLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : "Launch Production Workspace"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}