'use client';

import React, { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarInset,
  SidebarMenuSub,
  SidebarMenuSubButton,
  useSidebar,
} from '@/components/ui/sidebar';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
    LayoutDashboard, 
    ArrowLeftRight, 
    Package, 
    FileText, 
    Users, 
    PieChart, 
    Banknote, 
    Users2, 
    LifeBuoy, 
    AppWindow, 
    Settings, 
    LogOut, 
    Briefcase, 
    Receipt, 
    ChevronDown, 
    Store, 
    MonitorSpeaker, 
    BookText, 
    Wrench,
    CalendarClock,
    UserX,
    BarChart3,
    UserPlus,
    Loader2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Header } from '@/components/header';
import Link from 'next/link';
import { Logo } from '@/components/logo';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import { AIAssistant } from './ai-assistant';
import type { BusinessType } from '@/lib/data';
import { MobileNav } from './mobile-nav';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseUser } from '@/hooks/use-supabase-user';

function NavItem({ item, pathname }: { item: any, pathname: string }) {
    const { setOpenMobile, isMobile } = useSidebar();
    const isActive = item.children ? pathname.startsWith(item.href) : pathname === item.href;

    const handleLinkClick = () => {
        if (isMobile) {
            setOpenMobile(false);
        }
    };

    if (item.children && item.children.length > 0) {
        return (
             <Collapsible defaultOpen={pathname.startsWith(item.href)}>
                <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                         <SidebarMenuButton 
                            asChild 
                            isActive={isActive} 
                            tooltip={item.label} 
                            className="justify-between"
                        >
                            <div className="cursor-pointer">
                                <div className="flex items-center gap-2">
                                    <item.icon className="h-4 w-4" />
                                    <span>{item.label}</span>
                                </div>
                                <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", "[&[data-state=open]]:-rotate-180")} />
                            </div>
                        </SidebarMenuButton>
                    </CollapsibleTrigger>
                </SidebarMenuItem>
                <CollapsibleContent>
                    <SidebarMenuSub>
                        {item.children.map((child: any) => (
                             <SidebarMenuItem key={child.href}>
                                <SidebarMenuSubButton 
                                    asChild 
                                    isActive={pathname === child.href} 
                                    onClick={handleLinkClick}
                                >
                                    <Link href={child.href}>{child.label}</Link>
                                </SidebarMenuSubButton>
                            </SidebarMenuItem>
                        ))}
                    </SidebarMenuSub>
                </CollapsibleContent>
            </Collapsible>
        )
    }

    return (
        <SidebarMenuItem>
            <SidebarMenuButton 
                asChild 
                isActive={isActive} 
                tooltip={item.label} 
                onClick={handleLinkClick}
            >
              <Link href={item.href}>
                <item.icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            </SidebarMenuButton>
        </SidebarMenuItem>
    )
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const { user, loading: userLoading } = useSupabaseUser();
  
  const [businessProfile, setBusinessProfile] = useState<any>(null);
  const [businessLoading, setBusinessLoading] = useState(true);
  const [businessType, setBusinessType] = useState<BusinessType>('HYBRID');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!userLoading && !user && !['/login', '/signup', '/verify-email', '/setup'].includes(pathname)) {
        router.push('/login');
    }
  }, [user, userLoading, pathname, router]);

  useEffect(() => {
    if (user) {
      const fetchProfile = async () => {
        const { data } = await supabase
          .from('business_members')
          .select('role, businesses (*)')
          .eq('user_id', user.id)
          .maybeSingle();
        
        if (data) {
          setBusinessProfile({
            ...data.businesses,
            role: data.role
          });
          if (data.businesses.business_type) {
            setBusinessType(data.businesses.business_type as BusinessType);
          }
        }
        setBusinessLoading(false);
      };
      fetchProfile();
    } else {
      setBusinessLoading(false);
    }
  }, [user, supabase]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  const navItems = [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    ...(businessType !== 'SERVICE' ? [
        { href: '/pos', label: 'POS Checkout', icon: MonitorSpeaker },
    ] : []),
    ...(businessType !== 'PRODUCT' ? [
        { href: '/appointments', label: 'Appointments', icon: CalendarClock },
        { href: '/jobs', label: 'Work Orders / Jobs', icon: Wrench },
    ] : []),
    { href: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
    { href: '/invoices', label: 'Invoices & Receipts', icon: Receipt },
    { href: '/catalog', label: 'Inventory', icon: Package },
    { href: '/storefront', label: 'Storefront', icon: Store },
    {
      href: '/accounting',
      label: 'Accounting',
      icon: BookText,
      children: [
        { href: '/accounting/chart-of-accounts', label: 'Chart of Accounts' },
        { href: '/accounting/journal-entries', label: 'Journal Adjustments' },
        { href: '/accounting/trial-balance', label: 'Trial Balance' },
      ],
    },
    { href: '/reports', label: 'Reports', icon: FileText },
    { href: '/customers', label: 'Customers', icon: Users },
    { 
      href: '/analytics', 
      label: 'Analytics', 
      icon: PieChart,
      children: [
          { href: '/analytics/kpi', label: 'KPIs' },
          { href: '/analytics/planning', label: 'Planning & Budgeting' },
          { href: '/analytics/budget-vs-actual', label: 'Budget vs. Actual' },
          { href: '/analytics/reconciliation', label: 'Reconciliation' },
          { href: '/analytics/top-selling', label: 'Top-Selling' },
          { href: '/analytics/aging-reports', label: 'Aging Reports' },
      ]
    },
    { href: '/credit', label: 'Credit', icon: Banknote },
    {
      href: '/hr',
      label: 'HR',
      icon: Users2,
      children: [
        { href: '/hr/onboarding', label: 'Onboarding', icon: UserPlus },
        { href: '/hr/employees', label: 'Employees' },
        { href: '/hr/attendance', label: 'Attendance' },
        { href: '/hr/payroll', label: 'Payroll' },
        { href: '/hr/payroll/reports', label: 'Workforce Analytics', icon: BarChart3 },
        { href: '/hr/termination', label: 'Exits & Termination' },
      ],
    },
    { href: '/community', label: 'Community', icon: LifeBuoy },
    { href: '/apps', label: 'Integrations', icon: AppWindow },
  ];

  if (pathname === '/setup' || pathname === '/login' || pathname === '/signup' || pathname === '/verify-email') {
    return <div className="min-h-screen bg-background">{children}</div>;
  }

  if (!mounted || userLoading || (user && businessLoading)) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="h-10 w-10 animate-spin text-primary" /></div>;
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" className="hidden lg:flex">
        <SidebarHeader>
            <div className="flex items-center gap-2 p-2">
                {businessProfile?.logoUrl ? (
                    <Image src={businessProfile.logoUrl} alt="Logo" width={32} height={32} className="size-8 shrink-0 rounded-sm object-contain" />
                ) : (
                    <Logo className="size-8 shrink-0" />
                )}
                <span className="font-headline text-2xl font-semibold truncate group-data-[state=collapsed]:hidden text-primary">
                    {businessProfile?.name || 'CACU'}
                </span>
            </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            {navItems.map((item) => (
              <NavItem key={item.label} item={item} pathname={pathname} />
            ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Settings">
                    <Link href="/settings">
                        <Settings className="h-4 w-4" />
                        <span>Settings</span>
                    </Link>
                </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
                <SidebarMenuButton tooltip="Logout" onClick={handleLogout} className="text-destructive hover:text-destructive hover:bg-destructive/5">
                    <LogOut className="h-4 w-4" />
                    <span>Logout</span>
                </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <div className="flex items-center gap-3 p-2 mt-2 border-t">
            <Avatar className="size-8 border-2 border-primary/20">
              <AvatarImage src={user?.user_metadata?.avatar_url || "https://placehold.co/40x40"} alt="User" />
              <AvatarFallback>{user?.email?.charAt(0).toUpperCase() || 'U'}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col overflow-hidden group-data-[state=collapsed]:hidden">
                <span className="truncate text-sm font-medium">{user?.user_metadata?.full_name || user?.email?.split('@')[0]}</span>
                <span className="truncate text-[10px] text-muted-foreground uppercase font-bold tracking-tighter">{businessProfile?.role || 'User'}</span>
            </div>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <Header />
        <main className="p-4 lg:p-8 flex-1 overflow-auto bg-muted/5 pb-20 lg:pb-8">
          {children}
        </main>
        <MobileNav />
        <AIAssistant />
      </SidebarInset>
    </SidebarProvider>
  );
}
