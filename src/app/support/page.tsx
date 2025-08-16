import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, MessageSquare, Award, Users, Mic } from 'lucide-react';

function FeatureCard({ icon: Icon, title, description }: { icon: React.ElementType, title: string, description: string }) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center gap-4">
                <div className="bg-primary/10 p-3 rounded-full">
                    <Icon className="h-6 w-6 text-primary" />
                </div>
                <div>
                    <CardTitle>{title}</CardTitle>
                </div>
            </CardHeader>
            <CardContent>
                <p className="text-muted-foreground">{description}</p>
            </CardContent>
        </Card>
    );
}


export default function SupportPage() {
    return (
        <div className="flex flex-col gap-8">
            <div className="text-center">
                <h1 className="font-headline text-4xl font-bold tracking-tight">Support & Community</h1>
                <p className="mt-2 text-lg text-muted-foreground">Connect, learn, and grow with fellow business owners.</p>
            </div>

            <div className="relative mx-auto w-full max-w-2xl">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input placeholder="Search discussions, members, or topics..." className="pl-10 text-base" />
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2">
                <FeatureCard
                    icon={MessageSquare}
                    title="Discussion Forums"
                    description="Engage in conversations by topic, country, or industry. Share your knowledge and get advice from peers."
                />
                <FeatureCard
                    icon={Users}
                    title="Peer-to-Peer Support"
                    description="Get answers to your burning questions from a community of experienced entrepreneurs."
                />
                <FeatureCard
                    icon={Mic}
                    title="Ask-an-Expert (AMA) Sessions"
                    description="Join live sessions with industry experts and get your questions answered in real-time."
                />
                <FeatureCard
                    icon={Award}
                    title="Grant & Funding Alerts"
                    description="Stay informed about the latest grants, loans, and funding opportunities for your business."
                />
            </div>
             <Card className="text-center">
                <CardHeader>
                    <CardTitle>Showcase Your Business</CardTitle>
                    <CardDescription>Get featured in our community showcase and gain visibility.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Button>Nominate Your Business</Button>
                </CardContent>
            </Card>
        </div>
    );
}
