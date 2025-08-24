import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle, Upload, Handshake, ExternalLink } from 'lucide-react';

export default function CreditPage() {
    return (
        <div className="flex flex-col gap-8">
            <div className="text-center">
                <h1 className="font-headline text-3xl sm:text-4xl font-bold tracking-tight">Credit Access & Offers</h1>
                <p className="mt-2 text-lg text-muted-foreground">Explore financing options tailored for your business growth.</p>
            </div>

            <div className="grid gap-8 md:grid-cols-1 lg:grid-cols-3">
                <Card className="flex flex-col">
                    <CardHeader>
                        <div className="flex justify-center mb-4">
                            <div className="bg-primary/10 p-4 rounded-full">
                                <CheckCircle className="h-10 w-10 text-primary" />
                            </div>
                        </div>
                        <CardTitle className="text-center">Pre-Qualified Loan Offers</CardTitle>
                        <CardDescription className="text-center">
                            View loan offers you are already pre-qualified for based on your business profile and financial data.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow flex flex-col justify-end mt-4">
                        <Button className="w-full">
                            View My Offers
                            <ExternalLink className="ml-2 h-4 w-4" />
                        </Button>
                    </CardContent>
                </Card>

                <Card className="flex flex-col">
                    <CardHeader>
                        <div className="flex justify-center mb-4">
                            <div className="bg-primary/10 p-4 rounded-full">
                                <Upload className="h-10 w-10 text-primary" />
                            </div>
                        </div>
                        <CardTitle className="text-center">Loan Application Portal</CardTitle>
                        <CardDescription className="text-center">
                            Apply for new loans directly through our secure portal. Upload required documents with ease and track status.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow flex flex-col justify-end mt-4">
                        <Button className="w-full">Start New Application</Button>
                    </CardContent>
                </Card>
                
                <Card className="flex flex-col">
                    <CardHeader>
                        <div className="flex justify-center mb-4">
                             <div className="bg-primary/10 p-4 rounded-full">
                                <Handshake className="h-10 w-10 text-primary" />
                            </div>
                        </div>
                        <CardTitle className="text-center">Recommended Lenders</CardTitle>
                        <CardDescription className="text-center">
                            Discover a curated list of trusted lenders and financial partners that match your business needs.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow flex flex-col justify-end mt-4">
                        <Button className="w-full">Browse Lenders</Button>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
