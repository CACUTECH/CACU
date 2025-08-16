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
} from '@/components/ui/sidebar';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { LayoutDashboard, ArrowLeftRight, Package, FileText, Users, PieChart, Banknote, Users2, LifeBuoy, AppWindow, Settings, LogOut, Briefcase } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Header } from '@/components/header';
import Link from 'next/link';
import { useTheme } from 'next-themes';

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { href: '/inventory', label: 'Inventory', icon: Package },
  { href: '/reports', label: 'Reports', icon: FileText },
  { href: '/customers', label: 'Customers', icon: Users },
  { href: '/analytics', label: 'Analytics', icon: PieChart },
  { href: '/credit', label: 'Credit', icon: Banknote },
  { href: '/hr', label: 'HR', icon: Users2 },
  { href: '/support', label: 'Support', icon: LifeBuoy },
  { href: '/apps', label: 'Integrations', icon: AppWindow },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { theme } = useTheme();

  // A simple logo component. You can replace this with your own logo.
  const Logo = ({ className }: { className?: string }) => (
    <svg
      className={className}
      viewBox="0 0 50 50"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
        <path d="M9.6,20.5c0,-5.8 4.7,-10.5 10.5,-10.5h10.8c5.8,0 10.5,4.7 10.5,10.5v0c0,0 -20.8,0 -31.8,0z" style={{fill: 'rgb(88, 88, 255)'}} />
        <path d="M2.1,27.6c0,-5.8 4.7,-10.5 10.5,-10.5h25.7c5.8,0 10.5,4.7 10.5,10.5v12.2c0,5.8 -4.7,10.5 -10.5,10.5h-25.7c-5.8,0 -10.5,-4.7 -10.5,-10.5z" style={{fill: 'rgb(24, 24, 133)'}} />
    </svg>
  );

  // Hide sidebar and header for setup page
  if (pathname === '/setup' || pathname === '/login') {
    return <main>{children}</main>;
  }

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <div className="flex items-center gap-2 p-2">
            <Logo className="size-8 shrink-0" />
            <span className="font-headline text-xl font-semibold text-primary">CACU</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            {navItems.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton asChild isActive={pathname === item.href} tooltip={item.label}>
                  <Link href={item.href}>
                    <item.icon />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter className="flex flex-col gap-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname.startsWith('/settings')} tooltip="Settings">
                <Link href="/settings">
                  <Settings />
                  <span>Settings</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === '/setup'} tooltip="Initial Setup">
                <Link href="/setup">
                  <Briefcase />
                  <span>Business Setup</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <div className="flex items-center gap-3 p-2">
            <Avatar className="size-8">
              <AvatarImage src="https://placehold.co/40x40" alt="User" data-ai-hint="person portrait" />
              <AvatarFallback>U</AvatarFallback>
            </Avatar>
            <div className="flex flex-col overflow-hidden">
              <span className="truncate text-sm font-medium">Jane Doe</span>
              <span className="truncate text-xs text-muted-foreground">jane.doe@example.com</span>
            </div>
            <Button variant="ghost" size="icon" className="ml-auto shrink-0">
              <LogOut className="size-4" />
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <Header />
        <main className="p-4 lg:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
