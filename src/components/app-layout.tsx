
"use client";

import React, { useState, useEffect } from 'react';
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
    BarChart3
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
                            <Link href={item.href} onClick={handleLinkClick}>
                                <div className="flex items-center gap-2">
                                    <item.icon className="h-4 w-4" />
                                    <span>{item.label}</span>
                                </div>
                                <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", "[&[data-state=open]]:-rotate-180")} />
                            </Link>
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
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState('CACU');
  const [businessType, setBusinessType] = useState<BusinessType>('HYBRID');
  const [mounted, setMounted] = useState(false);

  const [userRole, setUserRole] = useState<'Owner' | 'Admin' | 'Staff'>('Owner');
  const [userPermissions, setUserPermissions] = useState<string[]>([]);

  useEffect(() => {
    setMounted(true);
    const savedLogo = localStorage.getItem('business-logo');
    const savedDetails = localStorage.getItem('business-details');
    const savedType = localStorage.getItem('business-type') as BusinessType;
    
    setUserPermissions([
        'pos', 'appointments', 'jobs', 'transactions', 'invoices', 'catalog', 'accounting', 
        'accounting:chart-of-accounts', 'accounting:journal-entries', 'accounting:trial-balance',
        'reports', 'customers', 'analytics', 'analytics:kpi', 'analytics:planning', 
        'analytics:budget-vs-actual', 'analytics:reconciliation', 'analytics:top-selling', 'analytics:aging-reports',
        'hr', 'hr:employees', 'hr:attendance', 'hr:payroll', 'hr:termination', 'hr:payroll:reports', 'community', 'apps', 'credit'
    ]);

    if (savedLogo) setLogoUrl(savedLogo);
    if (savedType) setBusinessType(savedType);
    if (savedDetails) {
        try {
            const details = JSON.parse(savedDetails);
            if(details.name) setBusinessName(details.name);
        } catch (e) {
            setBusinessName('CACU');
        }
    }
  }, []);

  const navItems = [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    ...(businessType !== 'SERVICE' && userPermissions.includes('pos') ? [
        { href: '/pos', label: 'POS Checkout', icon: MonitorSpeaker },
    ] : []),
    ...(businessType !== 'PRODUCT' ? [
        ...(userPermissions.includes('appointments') ? [{ href: '/appointments', label: 'Appointments', icon: CalendarClock }] : []),
        ...(userPermissions.includes('jobs') ? [{ href: '/jobs', label: 'Work Orders / Jobs', icon: Wrench }] : []),
    ] : []),
    ...(userPermissions.includes('transactions') ? [{ href: '/transactions', label: 'Transactions', icon: ArrowLeftRight }] : []),
    ...(userPermissions.includes('invoices') ? [{ href: '/invoices', label: 'Invoices & Receipts', icon: Receipt }] : []),
    ...(userPermissions.includes('catalog') ? [{ href: '/catalog', label: businessType === 'SERVICE' ? 'Service Menu' : 'Catalog', icon: Package }] : []),
    ...(userPermissions.includes('storefront') ? [{ href: '/storefront', label: 'Storefront', icon: Store }] : []),
    ...(userPermissions.includes('accounting') ? [{
      href: '/accounting',
      label: 'Accounting',
      icon: BookText,
      children: [
        ...(userPermissions.includes('accounting:chart-of-accounts') ? [{ href: '/accounting/chart-of-accounts', label: 'Chart of Accounts' }] : []),
        ...(userPermissions.includes('accounting:journal-entries') ? [{ href: '/accounting/journal-entries', label: 'Journal Adjustments' }] : []),
        ...(userPermissions.includes('accounting:trial-balance') ? [{ href: '/accounting/trial-balance', label: 'Trial Balance' }] : []),
      ],
    }] : []),
    ...(userPermissions.includes('reports') ? [{ href: '/reports', label: 'Reports', icon: FileText }] : []),
    ...(userPermissions.includes('customers') ? [{ href: '/customers', label: 'Customers', icon: Users }] : []),
    ...(userPermissions.includes('analytics') ? [{ 
      href: '/analytics', 
      label: 'Analytics', 
      icon: PieChart,
      children: [
          ...(userPermissions.includes('analytics:kpi') ? [{ href: '/analytics/kpi', label: 'KPIs' }] : []),
          ...(userPermissions.includes('analytics:planning') ? [{ href: '/analytics/planning', label: 'Planning & Budgeting' }] : []),
          ...(userPermissions.includes('analytics:budget-vs-actual') ? [{ href: '/analytics/budget-vs-actual', label: 'Budget vs. Actual' }] : []),
          ...(userPermissions.includes('analytics:reconciliation') ? [{ href: '/analytics/reconciliation', label: 'Reconciliation' }] : []),
          ...(userPermissions.includes('analytics:top-selling') ? [{ href: '/analytics/top-selling', label: 'Top-Selling' }] : []),
          ...(userPermissions.includes('analytics:aging-reports') ? [{ href: '/analytics/aging-reports', label: 'Aging Reports' }] : []),
      ]
    }] : []),
    ...(userPermissions.includes('credit') ? [{ href: '/credit', label: 'Credit', icon: Banknote }] : []),
    ...(userPermissions.includes('hr') ? [{
      href: '/hr',
      label: 'HR',
      icon: Users2,
      children: [
        ...(userPermissions.includes('hr:employees') ? [{ href: '/hr/employees', label: 'Employees' }] : []),
        ...(userPermissions.includes('hr:attendance') ? [{ href: '/hr/attendance', label: 'Attendance' }] : []),
        ...(userPermissions.includes('hr:payroll') ? [{ href: '/hr/payroll', label: 'Payroll' }] : []),
        ...(userPermissions.includes('hr:payroll:reports') ? [{ href: '/hr/payroll/reports', label: 'Workforce Analytics', icon: BarChart3 }] : []),
        ...(userPermissions.includes('hr:termination') ? [{ href: '/hr/termination', label: 'Exits & Termination' }] : []),
      ],
    }] : []),
    ...(userPermissions.includes('community') ? [{ href: '/community', label: 'Community', icon: LifeBuoy }] : []),
    ...(userPermissions.includes('apps') ? [{ href: '/apps', label: 'Integrations', icon: AppWindow }] : []),
  ];

  if (pathname === '/setup' || pathname === '/login' || pathname === '/signup' || pathname === '/verify-email') {
    return <div className="min-h-screen bg-background">{children}</div>;
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
            <div className="flex items-center gap-2 p-2">
                {logoUrl ? (
                    <Image src={logoUrl} alt="Logo" width={32} height={32} className="size-8 shrink-0 rounded-sm object-contain" />
                ) : (
                    <Logo className="size-8 shrink-0" />
                )}
                <span className="font-headline text-2xl font-semibold truncate group-data-[state=collapsed]:hidden text-primary">
                    {businessName}
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
          </SidebarMenu>
          <div className="flex items-center gap-3 p-2">
            <Avatar className="size-8">
              <AvatarImage src="https://placehold.co/40x40" alt="User" />
              <AvatarFallback>U</AvatarFallback>
            </Avatar>
            <div className="flex flex-col overflow-hidden group-data-[state=collapsed]:hidden">
                <span className="truncate text-sm font-medium">Jane Doe</span>
                <span className="truncate text-[10px] text-muted-foreground uppercase font-bold tracking-tighter">{userRole}</span>
            </div>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <Header />
        <main className="p-4 lg:p-8 flex-1 overflow-auto bg-muted/5">
          {children}
        </main>
        <AIAssistant />
      </SidebarInset>
    </SidebarProvider>
  );
}
