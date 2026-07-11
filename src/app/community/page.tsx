"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Search, MessageSquare, Award, Users, Mic, Calendar, ArrowRight, Star, TrendingUp, PlusCircle, Loader2 } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import Image from "next/image";
import placeholders from "@/app/lib/placeholder-images.json";
import { cn } from "@/lib/utils";

const forumTopics = [
    { id: 1, title: "Adapting to new FX regulations in Nigeria", category: "Finance", replies: 24, views: "1.2k", lastPost: "2h ago" },
    { id: 2, title: "Best POS systems for retail shops in Lagos", category: "Technology", replies: 45, views: "3.4k", lastPost: "5h ago" },
    { id: 3, title: "Scaling your agribusiness to export markets", category: "Agitech", replies: 12, views: "850", lastPost: "1d ago" },
    { id: 4, title: "How to apply for the latest BOI grants", category: "Funding", replies: 89, views: "10k", lastPost: "30m ago" },
];

const grantAlerts = [
    { 
        id: 1, 
        title: "LSETF Employment Trust Fund", 
        amount: "Up to ₦5M", 
        deadline: "Aug 30, 2024", 
        type: "Loan/Grant",
        url: "https://lsetf.ng/"
    },
    { 
        id: 2, 
        title: "Tony Elumelu Foundation 2024", 
        amount: "$5,000", 
        deadline: "Closed (Waitlist)", 
        type: "Grant",
        url: "https://www.tonyelumelufoundation.org/"
    },
    { 
        id: 3, 
        title: "Bank of Industry MSME Fund", 
        amount: "Up to ₦10M", 
        deadline: "Ongoing", 
        type: "Loan",
        url: "https://www.boi.ng/micro-small-medium-enterprises/"
    },
];

const upcomingAMAs = [
    { id: 1, host: "Segun Agbaje", role: "MD, GTBank", topic: "The Future of Digital Banking", date: "Aug 15, 2:00 PM", imageKey: "ama-host-1" },
    { id: 2, host: "Funke Opeke", role: "CEO, MainOne", topic: "Scaling Tech Infrastructure", date: "Aug 22, 11:00 AM", imageKey: "ama-host-2" },
];

export default function CommunityPage() {
    const { toast } = useToast();
    const [searchTerm, setSearchTerm] = React.useState("");
    const [isCreatingThread, setIsCreatingThread] = React.useState(false);
    const [newThread, setNewThread] = React.useState({ title: "", category: "Finance", content: "" });

    const filteredTopics = React.useMemo(() => 
        forumTopics.filter(t => 
            t.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
            t.category.toLowerCase().includes(searchTerm.toLowerCase())
        ), [searchTerm]);

    const filteredGrants = React.useMemo(() => 
        grantAlerts.filter(g => 
            g.title.toLowerCase().includes(searchTerm.toLowerCase())
        ), [searchTerm]);

    const filteredAMAs = React.useMemo(() => 
        upcomingAMAs.filter(a => 
            a.host.toLowerCase().includes(searchTerm.toLowerCase()) || 
            a.topic.toLowerCase().includes(searchTerm.toLowerCase())
        ), [searchTerm]);

    const handleCreateThread = () => {
        if (!newThread.title || !newThread.content) {
            toast({ variant: "destructive", title: "Missing Information", description: "Please provide a title and content for your discussion." });
            return;
        }

        setIsCreatingThread(true);
        setTimeout(() => {
            toast({ title: "Thread Published", description: "Your discussion has been posted to the forum." });
            setIsCreatingThread(false);
            setNewThread({ title: "", category: "Finance", content: "" });
        }, 1000);
    };

    const handleSetReminder = (host: string) => {
        toast({
            title: "Reminder Set!",
            description: `We'll notify you when ${host} goes live.`,
            action: <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700">Scheduled</Badge>
        });
    };

    const handleApplyGrant = (title: string, url: string) => {
        toast({
            title: "Redirecting to Provider",
            description: `Opening the official portal for ${title}...`,
        });
        setTimeout(() => {
            window.open(url, '_blank', 'noopener,noreferrer');
        }, 500);
    };

    return (
        <div className="flex flex-col gap-8 pb-12">
            <div className="text-center space-y-2">
                <h1 className="font-headline text-3xl sm:text-4xl font-bold tracking-tight">Community Hub</h1>
                <p className="text-lg text-muted-foreground">Connect, learn, and grow with 5,000+ fellow business owners.</p>
            </div>

            <div className="relative mx-auto w-full max-w-2xl">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input 
                    placeholder="Search discussions, grants, or members..." 
                    className="pl-10 text-base h-12 shadow-sm rounded-xl" 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            <Tabs defaultValue="forums" className="w-full">
                <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4 h-auto p-1 bg-primary/5 border border-primary/10 shadow-lg shadow-primary/5 rounded-xl">
                    <TabsTrigger 
                        value="forums" 
                        className="py-2.5 rounded-lg data-[state=active]:bg-indigo-600 data-[state=active]:text-white transition-all shadow-sm"
                    >
                        <MessageSquare className="w-4 h-4 mr-2" /> Forums
                    </TabsTrigger>
                    <TabsTrigger 
                        value="support" 
                        className="py-2.5 rounded-lg data-[state=active]:bg-emerald-600 data-[state=active]:text-white transition-all shadow-sm"
                    >
                        <Users className="w-4 h-4 mr-2" /> Support
                    </TabsTrigger>
                    <TabsTrigger 
                        value="ama" 
                        className="py-2.5 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all shadow-sm"
                    >
                        <Mic className="w-4 h-4 mr-2" /> AMAs
                    </TabsTrigger>
                    <TabsTrigger 
                        value="grants" 
                        className="py-2.5 rounded-lg data-[state=active]:bg-amber-600 data-[state=active]:text-white transition-all shadow-sm"
                    >
                        <Award className="w-4 h-4 mr-2" /> Grants
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="forums" className="mt-6 space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-bold font-headline">Recent Discussions</h2>
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button size="sm" className="rounded-xl">
                                    <PlusCircle className="mr-2 h-4 w-4" />
                                    Start New Thread
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-md">
                                <DialogHeader>
                                    <DialogTitle className="font-headline text-xl">Start a Conversation</DialogTitle>
                                    <DialogDescription>Share insights or ask a question to the community.</DialogDescription>
                                </DialogHeader>
                                <div className="grid gap-4 py-4">
                                    <div className="space-y-2">
                                        <Label>Topic Title</Label>
                                        <Input 
                                            placeholder="e.g. Navigating Q4 Logistics" 
                                            value={newThread.title}
                                            onChange={(e) => setNewThread({...newThread, title: e.target.value})}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Category</Label>
                                        <Select value={newThread.category} onValueChange={(val) => setNewThread({...newThread, category: val})}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="Finance">Finance</SelectItem>
                                                <SelectItem value="Technology">Technology</SelectItem>
                                                <SelectItem value="Agitech">Agitech</SelectItem>
                                                <SelectItem value="Funding">Funding</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Your Message</Label>
                                        <Textarea 
                                            placeholder="What's on your mind?" 
                                            className="min-h-[100px]" 
                                            value={newThread.content}
                                            onChange={(e) => setNewThread({...newThread, content: e.target.value})}
                                        />
                                    </div>
                                </div>
                                <DialogFooter>
                                    <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                                    <Button onClick={handleCreateThread} disabled={isCreatingThread}>
                                        {isCreatingThread ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                        Post Thread
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </div>
                    
                    {filteredTopics.length === 0 ? (
                        <div className="py-12 text-center text-muted-foreground italic bg-muted/20 rounded-xl border border-dashed">
                            No discussions found matching your search.
                        </div>
                    ) : filteredTopics.map(topic => (
                        <Card key={topic.id} className="hover:border-primary/50 transition-colors cursor-pointer group" onClick={() => toast({ title: "Opening Discussion...", description: `Loading thread: ${topic.title}` })}>
                            <CardHeader className="p-4 sm:p-6">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <Badge variant="secondary" className="bg-primary/5 text-primary border-primary/10">{topic.category}</Badge>
                                            <span className="text-xs text-muted-foreground">{topic.lastPost}</span>
                                        </div>
                                        <CardTitle className="text-lg group-hover:text-primary transition-colors">{topic.title}</CardTitle>
                                    </div>
                                    <div className="flex gap-4 text-sm text-muted-foreground">
                                        <div className="flex flex-col items-center">
                                            <span className="font-bold text-foreground">{topic.replies}</span>
                                            <span>replies</span>
                                        </div>
                                        <div className="flex flex-col items-center">
                                            <span className="font-bold text-foreground">{topic.views}</span>
                                            <span>views</span>
                                        </div>
                                    </div>
                                </div>
                            </CardHeader>
                        </Card>
                    ))}
                </TabsContent>

                <TabsContent value="support" className="mt-6 space-y-6">
                    <Card className="bg-primary/5 border-primary/10">
                        <CardHeader>
                            <CardTitle>Peer-to-Peer Help</CardTitle>
                            <CardDescription>Get advice from entrepreneurs who have been there.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="p-4 rounded-xl border bg-card">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                                        <span className="text-sm font-bold">Top Contributor</span>
                                    </div>
                                    <p className="text-sm italic">"Don't worry about the clearing delays at Apapa, there's a workaround using the Bonded Terminal system..."</p>
                                    <div className="mt-3 flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold">BO</div>
                                        <span className="text-xs font-medium">Bayo O. (Retail Expert)</span>
                                    </div>
                                </div>
                                <div className="p-4 rounded-xl border bg-card">
                                    <div className="flex items-center gap-2 mb-2">
                                        <TrendingUp className="w-4 h-4 text-green-500" />
                                        <span className="text-sm font-bold">Trending Question</span>
                                    </div>
                                    <p className="text-sm">"How are you guys handling the diesel price hike for your factory generators?"</p>
                                    <Button variant="link" size="sm" className="px-0 h-auto mt-2" onClick={() => toast({ title: "Redirecting...", description: "Joining the conversation on Energy Management." })}>Join Conversation</Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="ama" className="mt-6 space-y-4">
                    <h2 className="text-xl font-bold font-headline">Upcoming AMA Sessions</h2>
                    <div className="grid gap-4 md:grid-cols-2">
                        {filteredAMAs.length === 0 ? (
                            <div className="col-span-full py-12 text-center text-muted-foreground italic">No upcoming sessions matching your criteria.</div>
                        ) : filteredAMAs.map(ama => {
                            const image = (placeholders as any)[ama.imageKey];
                            return (
                                <Card key={ama.id} className="overflow-hidden">
                                    <CardHeader>
                                        <div className="flex items-center gap-4">
                                            <div className="relative w-12 h-12 shrink-0">
                                                <Image
                                                    src={image.url}
                                                    alt={ama.host}
                                                    width={image.width}
                                                    height={image.height}
                                                    className="rounded-full object-cover border-2 border-primary/20 shadow-sm"
                                                    data-ai-hint={image.hint}
                                                />
                                                <div className="absolute -bottom-1 -right-1 bg-primary text-primary-foreground rounded-full p-1 border-2 border-background shadow-sm">
                                                    <Mic className="h-3 w-3" />
                                                </div>
                                            </div>
                                            <div>
                                                <CardTitle className="text-base">{ama.host}</CardTitle>
                                                <CardDescription>{ama.role}</CardDescription>
                                            </div>
                                        </div>
                                    </CardHeader>
                                    <CardContent>
                                        <p className="font-medium text-sm mb-4">{ama.topic}</p>
                                        <div className="flex items-center text-xs text-muted-foreground gap-2">
                                            <Calendar className="w-3 h-3" />
                                            {ama.date}
                                        </div>
                                    </CardContent>
                                    <CardFooter className="bg-muted/30 border-t pt-4">
                                        <Button className="w-full" variant="outline" onClick={() => handleSetReminder(ama.host)}>Set Reminder</Button>
                                    </CardFooter>
                                </Card>
                            );
                        })}
                    </div>
                </TabsContent>

                <TabsContent value="grants" className="mt-6 space-y-4">
                    <h2 className="text-xl font-bold font-headline">Funding Alerts</h2>
                    <div className="grid gap-4">
                        {filteredGrants.length === 0 ? (
                            <div className="py-12 text-center text-muted-foreground italic">No grants found matching your search.</div>
                        ) : filteredGrants.map(grant => (
                            <Card key={grant.id} className="hover:border-amber-200 transition-colors">
                                <CardHeader className="pb-2">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <CardTitle className="text-lg">{grant.title}</CardTitle>
                                            <CardDescription className="text-primary font-bold text-base">{grant.amount}</CardDescription>
                                        </div>
                                        <Badge variant={grant.deadline.includes("Closed") ? "destructive" : "default"}>{grant.type}</Badge>
                                    </div>
                                </CardHeader>
                                <CardContent className="pb-4">
                                    <div className="text-sm text-muted-foreground flex items-center gap-2">
                                        <Calendar className="w-4 h-4" />
                                        Deadline: <span className={cn(grant.deadline.includes("Closed") ? "text-destructive font-medium" : "")}>{grant.deadline}</span>
                                    </div>
                                </CardContent>
                                <CardFooter className="pt-0">
                                    <Button 
                                        className="w-full rounded-xl" 
                                        disabled={grant.deadline.includes("Closed")}
                                        onClick={() => handleApplyGrant(grant.title, grant.url)}
                                    >
                                        Apply Now <ArrowRight className="ml-2 w-4 h-4" />
                                    </Button>
                                </CardFooter>
                            </Card>
                        ))}
                    </div>
                </TabsContent>
            </Tabs>

            <Card className="text-center bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20 shadow-xl shadow-primary/5 overflow-hidden relative">
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full -mr-16 -mt-16 blur-2xl" />
                <CardHeader>
                    <CardTitle className="text-2xl font-headline">Showcase Your Business</CardTitle>
                    <CardDescription className="text-base max-w-lg mx-auto">Get featured in our community showcase and gain visibility among 50,000+ Nigerian entrepreneurs.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Button size="lg" className="rounded-full px-8 shadow-lg shadow-primary/20" onClick={() => toast({ title: "Nomination Sent", description: "Our editorial team will review your profile and reach out shortly!" })}>Nominate Your Business</Button>
                </CardContent>
            </Card>
        </div>
    );
}
