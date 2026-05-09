"use client";

import React from 'react';
import { usePathname } from 'next/navigation';
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
import { LayoutDashboard, ArrowLeftRight, Package, FileText, Users, PieChart, Banknote, Users2, LifeBuoy, AppWindow, Settings, LogOut, Briefcase, Receipt, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Header } from '@/components/header';
import Link from 'next/link';
import { useTheme } from '@/components/theme-provider';
import { Logo } from '@/components/logo';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import { AIAssistant } from './ai-assistant';

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { href: '/invoices', label: 'Invoices & Receipts', icon: Receipt },
  { href: '/inventory', label: 'Inventory', icon: Package },
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
      { href: '/hr/employees', label: 'Employees' },
      { href: '/hr/attendance', label: 'Attendance' },
      { href: '/hr/payroll', label: 'Payroll' },
    ],
  },
  { href: '/community', label: 'Community', icon: LifeBuoy },
  { href: '/apps', label: 'Integrations', icon: AppWindow },
];

function NavItem({ item, pathname }: { item: typeof navItems[number], pathname: string }) {
    const { setOpenMobile, isMobile } = useSidebar();
    const isActive = item.children ? pathname.startsWith(item.href) : pathname === item.href;

    const handleLinkClick = () => {
        if (isMobile) {
            setOpenMobile(false);
        }
    };

    if (item.children) {
        return (
             <Collapsible defaultOpen={pathname.startsWith(item.href)}>
                <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                         <SidebarMenuButton asChild isActive={isActive} tooltip={item.label} className="justify-between" onClick={handleLinkClick}>
                            <Link href={item.href}>
                                <div className="flex items-center gap-2">
                                    <item.icon />
                                    <span>{item.label}</span>
                                </div>
                                <ChevronDown className={cn("transition-transform duration-200", "[&[data-state=open]]:-rotate-180")} />
                            </Link>
                        </SidebarMenuButton>
                    </CollapsibleTrigger>
                </SidebarMenuItem>
                <CollapsibleContent>
                    <SidebarMenuSub>
                        {item.children.map(child => (
                             <SidebarMenuItem key={child.href}>
                                <SidebarMenuSubButton asChild isActive={pathname === child.href} onClick={handleLinkClick}>
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
            <SidebarMenuButton asChild isActive={isActive} tooltip={item.label} onClick={handleLinkClick}>
              <Link href={item.href}>
                <item.icon />
                <span>{item.label}</span>
              </Link>
            </SidebarMenuButton>
        </SidebarMenuItem>
    )
}

function SidebarBrand({ logoUrl, businessName }: { logoUrl: string | null, businessName: string }) {
    const { state } = useSidebar();
    return (
        <div className="flex items-center gap-2 p-2">
            {logoUrl ? (
                <Image src={logoUrl} alt="Business Logo" width={32} height={32} className="size-8 shrink-0 rounded-sm object-contain" />
            ) : (
                <Logo className="size-8 shrink-0" />
            )}
            {state === "expanded" && (
                <span className="font-headline text-2xl font-semibold truncate" style={{color: "hsl(var(--primary))"}}>{businessName}</span>
            )}
        </div>
    )
}

function SidebarUser() {
    const { state } = useSidebar();
    return (
        <div className="flex items-center gap-3 p-2">
            <Avatar className="size-8">
              <AvatarImage src="https://placehold.co/40x40" alt="User" data-ai-hint="person portrait" />
              <AvatarFallback>U</AvatarFallback>
            </Avatar>
            {state === "expanded" && (
                <div className="flex flex-col overflow-hidden">
                    <span className="truncate text-sm font-medium">Jane Doe</span>
                    <span className="truncate text-xs text-muted-foreground">jane.doe@example.com</span>
                </div>
            )}
            {state === "expanded" && (
                <Button variant="ghost" size="icon" className="ml-auto shrink-0">
                    <LogOut className="size-4" />
                </Button>
            )}
        </div>
    )
}

function SidebarMenuButtonWrapper({ href, icon: Icon, label, isActive }: { href: string, icon: any, label: string, isActive: boolean }) {
    const { setOpenMobile, isMobile } = useSidebar();
    return (
        <SidebarMenuButton asChild isActive={isActive} tooltip={label} onClick={() => isMobile && setOpenMobile(false)}>
            <Link href={href}>
                <Icon />
                <span>{label}</span>
            </Link>
        </SidebarMenuButton>
    )
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [logoUrl, setLogoUrl] = React.useState<string | null>(null);
  const [businessName, setBusinessName] = React.useState('CACU');

  React.useEffect(() => {
    const savedLogo = localStorage.getItem('business-logo');
    const savedDetails = localStorage.getItem('business-details');
    if (savedLogo) {
      setLogoUrl(savedLogo);
    }
    if (savedDetails) {
        try {
            const details = JSON.parse(savedDetails);
            if(details.name) {
                setBusinessName(details.name);
            }
        } catch (e) {
            setBusinessName('CACU');
        }
    }
  }, []);

  if (pathname === '/setup' || pathname === '/login' || pathname === '/signup' || pathname === '/verify-email') {
    return <div className="min-h-screen bg-background">{children}</div>;
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarBrand logoUrl={logoUrl} businessName={businessName} />
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            {navItems.map((item) => (
              <NavItem key={item.href} item={item} pathname={pathname} />
            ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter className="flex flex-col gap-2">
          <SidebarMenu>
            <SidebarMenuItem>
                <SidebarMenuButtonWrapper href="/settings" icon={Settings} label="Settings" isActive={pathname.startsWith('/settings')} />
            </SidebarMenuItem>
            <SidebarMenuItem>
                <SidebarMenuButtonWrapper href="/setup" icon={Briefcase} label="Business Setup" isActive={pathname === '/setup'} />
            </SidebarMenuItem>
          </SidebarMenu>
          <SidebarUser />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <Header />
        <div className="p-4 lg:p-6 flex-1 overflow-auto">
          {children}
        </div>
        <AIAssistant />
      </SidebarInset>
    </SidebarProvider>
  );
}
