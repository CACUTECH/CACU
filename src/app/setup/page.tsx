import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { User, Book, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function SetupPage() {
    return (
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-10rem)]">
            <div className="text-center mb-12">
                <h1 className="font-headline text-4xl font-bold tracking-tight">Welcome to CACU!</h1>
                <p className="mt-2 text-lg text-muted-foreground">Let's get your business configured for success.</p>
            </div>

            <div className="grid gap-8 md:grid-cols-2 max-w-4xl w-full">
                <Card className="flex flex-col text-center">
                    <CardHeader>
                        <div className="mx-auto bg-primary/10 p-4 rounded-full w-fit mb-4">
                            <User className="h-10 w-10 text-primary" />
                        </div>
                        <CardTitle>Business Profile</CardTitle>
                        <CardDescription>
                            Define your company's core information, including name, address, industry, and registration details. This is key for reports and credit offers.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow flex flex-col justify-end">
                        <Button asChild>
                            <Link href="/settings/business">
                                Configure Profile <ArrowRight className="ml-2 h-4 w-4" />
                            </Link>
                        </Button>
                    </CardContent>
                </Card>

                <Card className="flex flex-col text-center">
                    <CardHeader>
                        <div className="mx-auto bg-primary/10 p-4 rounded-full w-fit mb-4">
                            <Book className="h-10 w-10 text-primary" />
                        </div>
                        <CardTitle>Chart of Accounts</CardTitle>
                        <CardDescription>
                            Set up your financial backbone by defining categories for your income, expenses, assets, and liabilities. We provide a helpful wizard.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow flex flex-col justify-end">
                        <Button asChild>
                            <Link href="/settings/accounts">
                                Setup Accounts <ArrowRight className="ml-2 h-4 w-4" />
                            </Link>
                        </Button>
                    </CardContent>
                </Card>
            </div>
             <div className="mt-8">
                <Button variant="link" asChild>
                    <Link href="/">Skip for now, I'll do this later</Link>
                </Button>
            </div>
        </div>
    );
}
