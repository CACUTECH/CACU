"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { MailCheck } from "lucide-react";

export default function VerifyEmailPage() {
  const { toast } = useToast();

  const handleResend = () => {
    // Placeholder for Firebase resend verification email
    toast({
      title: "Verification Email Sent",
      description: "Please check your inbox (and spam folder).",
    });
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background px-4">
      <Card className="mx-auto max-w-md w-full text-center">
        <CardHeader>
          <div className="mx-auto bg-primary/10 p-4 rounded-full w-fit mb-4">
            <MailCheck className="h-12 w-12 text-primary" />
          </div>
          <CardTitle className="text-2xl font-headline">Verify Your Email</CardTitle>
          <CardDescription>
            We've sent a verification link to your email address. Please click the link to continue.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Didn't receive the email? Check your spam folder or click below to resend.
          </p>
          <Button onClick={handleResend} className="w-full">
            Resend Verification Email
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
