import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { User, Briefcase, Users, Globe, Power, Banknote, FileText, Truck, Heart, ArrowRight, Palette, Bell } from 'lucide-react';
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
                        Manage Settings <ArrowRight className="ml-2 h-4 w-4" />
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
                <p className="text-muted-foreground">Manage your entire business ecosystem from one central place.</p>
            </div>

            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                <SettingCard icon={User} title="Profile" description="Update your personal account information and preferences." href="/settings/profile" />
                <SettingCard icon={Briefcase} title="Business" description="Configure your core business details, products, and services." href="/settings/business" />
                <SettingCard icon={Users} title="User Management" description="Invite and manage team members and their permissions." href="/settings/users" />
                <SettingCard icon={Globe} title="Language & Currency" description="Set your preferred language and default currency for reports." href="/settings/locale" />
                <SettingCard icon={Palette} title="Appearance" description="Customize the look and feel of the application." href="/settings/appearance" />
                <SettingCard icon={Bell} title="Notifications" description="Configure how you receive alerts and updates." href="/settings/notifications" />
                <SettingCard icon={Power} title="Offline Settings" description="Configure how the app behaves when you're not connected." href="/settings/offline" />
                <SettingCard icon={Banknote} title="Bank Linking" description="Connect and manage your bank accounts securely." href="/settings/banks" />
                <SettingCard icon={FileText} title="Tax Settings" description="Configure tax rates and settings for accurate calculations." href="/settings/taxes" />
                <SettingCard icon={Truck} title="Suppliers" description="Manage supplier details and set up low-stock alerts." href="/settings/suppliers" />
                <SettingCard icon={Heart} title="Customers" description="Tools for loyalty programs and customer management." href="/settings/customers" />
                 <SettingCard icon={FileText} title="Business Registration" description="Tools and guides for registering your business." href="/settings/registration" />
            </div>
        </div>
    );
}
