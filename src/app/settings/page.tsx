import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { User, Briefcase, Users, Globe, Power, Banknote, FileText, Truck, Heart, ArrowRight } from 'lucide-react';
import Link from 'next/link';

function SettingCard({ icon: Icon, title, description, href }: { icon: React.ElementType, title: string, description: string, href: string }) {
    return (
        <Card>
            <CardHeader>
                <div className="flex items-start gap-4">
                    <div className="bg-primary/10 p-3 rounded-full">
                        <Icon className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                        <CardTitle>{title}</CardTitle>
                        <CardDescription className="mt-1">{description}</CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <Button asChild variant="outline" size="sm" className="w-full">
                    <Link href={href}>
                        Manage <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                </Button>
            </CardContent>
        </Card>
    );
}


export default function SettingsPage() {
    return (
        <div className="flex flex-col gap-8">
            <div>
                <h1 className="font-headline text-3xl font-bold">Settings</h1>
                <p className="text-muted-foreground">Manage your entire business ecosystem from one place.</p>
            </div>

            <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
                <SettingCard icon={User} title="User Management" description="Invite and manage team members and their permissions." href="/settings/users" />
                <SettingCard icon={Briefcase} title="Business Settings" description="Configure your core business details, products, and services." href="/settings/business" />
                <SettingCard icon={Users} title="User Profile Settings" description="Update your personal account information and preferences." href="/settings/profile" />
                <SettingCard icon={Globe} title="Language & Currency" description="Set your preferred language and default currency for reports." href="/settings/locale" />
                <SettingCard icon={Power} title="Offline Settings" description="Configure how the app behaves when you're not connected." href="/settings/offline" />
                <SettingCard icon={Banknote} title="Bank Linking" description="Connect and manage your bank accounts securely." href="/settings/banks" />
                <SettingCard icon={FileText} title="Business Registration" description="Tools and guides for registering your business if you haven't already." href="/settings/registration" />
                <SettingCard icon={FileText} title="Tax Settings" description="Configure tax rates and settings for accurate calculations." href="/settings/taxes" />
                <SettingCard icon={Truck} title="Suppliers Management" description="Manage supplier details and set up low-stock alerts." href="/settings/suppliers" />
                <SettingCard icon={Heart} title="Customer Management" description="Tools for targeted advertising and loyalty programs." href="/settings/customers" />
            </div>
        </div>
    );
}
