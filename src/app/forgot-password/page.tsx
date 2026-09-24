
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
import Link from "next/link";
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
import { createClient } from "@/lib/supabase/client";
import { useState } from "react";
import { Loader2, ArrowLeft } from "lucide-react";

const formSchema = z.object({
  email: z.string().email("Invalid email address"),
});

export default function ForgotPasswordPage() {
  const { toast } = useToast();
  const supabase = createClient();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) throw error;

      toast({
        title: "Reset Email Sent",
        description: "Check your inbox for a password reset link.",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to send reset email.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background px-4">
      <Card className="mx-auto max-w-sm w-full shadow-2xl border-primary/5">
        <CardHeader>
          <CardTitle className="text-2xl font-headline text-primary">Reset Password</CardTitle>
          <CardDescription>
            Enter your email to receive a recovery link
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem className="grid gap-2">
                    <FormLabel>Email Address</FormLabel>
                    <FormControl>
                      <Input placeholder="m@example.com" disabled={isLoading} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full h-11 rounded-xl" disabled={isLoading}>
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Send Reset Link"}
              </Button>
              <Button variant="ghost" asChild className="w-full">
                <Link href="/login" className="flex items-center gap-2">
                  <ArrowLeft className="h-4 w-4" /> Back to Login
                </Link>
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
