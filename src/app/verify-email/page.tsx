
"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MailCheck, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function VerifyEmailPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background px-4">
      <Card className="mx-auto max-w-md w-full text-center shadow-2xl border-primary/5">
        <CardHeader>
          <div className="mx-auto bg-primary/10 p-4 rounded-full w-fit mb-4">
            <MailCheck className="h-12 w-12 text-primary" />
          </div>
          <CardTitle className="text-2xl font-headline text-primary">Verify Your Email</CardTitle>
          <CardDescription>
            We've sent a verification link to your email address. Please click the link to activate your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Once verified, you'll be able to launch your production workspace.
          </p>
          <Button asChild variant="outline" className="w-full h-11 rounded-xl">
            <Link href="/login" className="flex items-center justify-center gap-2">
              <ArrowLeft className="h-4 w-4" /> Back to Login
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
