"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Search, MessageSquare, Award, Users, Mic, Calendar, ArrowRight, Star, TrendingUp } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";

const forumTopics = [
    { id: 1, title: "Adapting to new FX regulations in Nigeria", category: "Finance", replies: 24, views: "1.2k", lastPost: "2h ago" },
    { id: 2, title: "Best POS systems for retail shops in Lagos", category: "Technology", replies: 45, views: "3.4k", lastPost: "5h ago" },
    { id: 3, title: "Scaling your agribusiness to export markets", category: "Agitech", replies: 12, views: "850", lastPost: "1d ago" },
    { id: 4, title: "How to apply for the latest BOI grants", category: "Funding", replies: 89, views: "10k", lastPost: "30m ago" },
];

const grantAlerts = [
    { id: 1, title: "LSETF Employment Trust Fund", amount: "Up to ₦5M", deadline: "Aug 30, 2024", type: "Loan/Grant" },
    { id: 2, title: "Tony Elumelu Foundation 2024", amount: "$5,000", deadline: "Closed (Waitlist)", type: "Grant" },
    { id: 3, title: "Bank of Industry MSME Fund", amount: "Up to ₦10M", deadline: "Ongoing", type: "Loan" },
];

const upcomingAMAs = [
    { id: 1, host: "Segun Agbaje", role: "MD, GTBank", topic: "The Future of Digital Banking", date: "Aug 15, 2:00 PM" },
    { id: 2, host: "Funke Opeke", role: "CEO, MainOne", topic: "Scaling Tech Infrastructure", date: "Aug 22, 11:00 AM" },
];

export default function CommunityPage() {
    const { toast } = useToast();

    return (
        <div className="flex flex-col gap-8">
            <div className="text-center space-y-2">
                <h1 className="font-headline text-3xl sm:text-4xl font-bold tracking-tight">Community Hub</h1>
                <p className="text-lg text-muted-foreground">Connect, learn, and grow with 5,000+ fellow business owners.</p>
            </div>

            <div className="relative mx-auto w-full max-w-2xl">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input placeholder="Search discussions, grants, or members..." className="pl-10 text-base h-12 shadow-sm rounded-xl" />
            </div>

            <Tabs defaultValue="forums" className="w-full">
                <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4 h-auto p-1 bg-muted/50 rounded-xl">
                    <TabsTrigger value="forums" className="py-2.5 rounded-lg"><MessageSquare className="w-4 h-4 mr-2" /> Forums</TabsTrigger>
                    <TabsTrigger value="support" className="py-2.5 rounded-lg"><Users className="w-4 h-4 mr-2" /> Support</TabsTrigger>
                    <TabsTrigger value="ama" className="py-2.5 rounded-lg"><Mic className="w-4 h-4 mr-2" /> AMAs</TabsTrigger>
                    <TabsTrigger value="grants" className="py-2.5 rounded-lg"><Award className="w-4 h-4 mr-2" /> Grants</TabsTrigger>
                </TabsList>

                <TabsContent value="forums" className="mt-6 space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-bold font-headline">Recent Discussions</h2>
                        <Button variant="outline" size="sm">Start New Thread</Button>
                    </div>
                    {forumTopics.map(topic => (
                        <Card key={topic.id} className="hover:border-primary/50 transition-colors cursor-pointer group">
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
                                        <div className="w-6 h-6 rounded-full bg-muted" />
                                        <span className="text-xs font-medium">Bayo O. (Retail Expert)</span>
                                    </div>
                                </div>
                                <div className="p-4 rounded-xl border bg-card">
                                    <div className="flex items-center gap-2 mb-2">
                                        <TrendingUp className="w-4 h-4 text-green-500" />
                                        <span className="text-sm font-bold">Trending Question</span>
                                    </div>
                                    <p className="text-sm">"How are you guys handling the diesel price hike for your factory generators?"</p>
                                    <Button variant="link" size="sm" className="px-0 h-auto mt-2">Join Conversation</Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="ama" className="mt-6 space-y-4">
                    <h2 className="text-xl font-bold font-headline">Upcoming AMA Sessions</h2>
                    <div className="grid gap-4 md:grid-cols-2">
                        {upcomingAMAs.map(ama => (
                            <Card key={ama.id}>
                                <CardHeader>
                                    <div className="flex items-center gap-4">
                                        <div className="bg-primary/10 p-3 rounded-full">
                                            <Mic className="h-6 w-6 text-primary" />
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
                                <CardFooter>
                                    <Button className="w-full" variant="outline" onClick={() => toast({ title: "Reminder Set!", description: `We'll notify you when ${ama.host} goes live.` })}>Set Reminder</Button>
                                </CardFooter>
                            </Card>
                        ))}
                    </div>
                </TabsContent>

                <TabsContent value="grants" className="mt-6 space-y-4">
                    <h2 className="text-xl font-bold font-headline">Funding Alerts</h2>
                    <div className="grid gap-4">
                        {grantAlerts.map(grant => (
                            <Card key={grant.id}>
                                <CardHeader className="pb-2">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <CardTitle className="text-lg">{grant.title}</CardTitle>
                                            <CardDescription className="text-primary font-bold">{grant.amount}</CardDescription>
                                        </div>
                                        <Badge variant={grant.deadline.includes("Closed") ? "destructive" : "default"}>{grant.type}</Badge>
                                    </div>
                                </CardHeader>
                                <CardContent className="pb-4">
                                    <div className="text-sm text-muted-foreground flex items-center gap-2">
                                        <Calendar className="w-4 h-4" />
                                        Deadline: {grant.deadline}
                                    </div>
                                </CardContent>
                                <CardFooter className="pt-0">
                                    <Button className="w-full" disabled={grant.deadline.includes("Closed")}>
                                        Apply Now <ArrowRight className="ml-2 w-4 h-4" />
                                    </Button>
                                </CardFooter>
                            </Card>
                        ))}
                    </div>
                </TabsContent>
            </Tabs>

            <Card className="text-center bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20 shadow-xl shadow-primary/5">
                <CardHeader>
                    <CardTitle className="text-2xl">Showcase Your Business</CardTitle>
                    <CardDescription className="text-base max-w-lg mx-auto">Get featured in our community showcase and gain visibility among 50,000+ Nigerian entrepreneurs.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Button size="lg" className="rounded-full px-8 shadow-lg shadow-primary/20">Nominate Your Business</Button>
                </CardContent>
            </Card>
        </div>
    );
}