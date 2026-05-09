"use client";

import React from 'react';
import { usePathname } from 'next/navigation';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import Link from 'next/link';
import { Button } from './ui/button';
import { Search, Bell, Sun, Moon } from 'lucide-react';
import { Input } from './ui/input';
import { useTheme } from "@/components/theme-provider";


const breadcrumbNameMap: { [key: string]: string } = {
  '/': 'Dashboard',
  '/transactions': 'Transactions',
  '/invoices': 'Invoices',
  '/inventory': 'Inventory',
  '/reports': 'Reports',
  '/customers': 'Customers',
  '/settings': 'Settings',
  '/support': 'Support',
  '/analytics': 'Analytics',
  '/credit': 'Credit',
  '/hr': 'HR',
  '/apps': 'Integrations',
  '/setup': 'Setup',
};

function ThemeToggle() {
    const { setTheme, theme } = useTheme()
    
    const toggleTheme = () => {
      setTheme(theme === 'light' ? 'dark' : 'light');
    }

    return (
        <Button variant="ghost" size="icon" onClick={toggleTheme}>
            <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            < Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="sr-only">Toggle theme</span>
        </Button>
    )
}

export function Header() {
  const pathname = usePathname();
  const pathSegments = pathname.split('/').filter(Boolean);

  const getBreadcrumbName = (href: string, segment: string) => {
    return breadcrumbNameMap[href] || segment.charAt(0).toUpperCase() + segment.slice(1).replace('-', ' ');
  }

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b bg-background/80 px-4 backdrop-blur-sm sm:h-16 sm:px-6">
      <div className="flex items-center gap-2">
        <SidebarTrigger />
      </div>

      <div className="hidden flex-1 md:block">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/">Dashboard</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            {pathSegments.map((segment, index) => {
              const href = `/${pathSegments.slice(0, index + 1).join('/')}`;
              const isLast = index === pathSegments.length - 1;
              const name = getBreadcrumbName(href, segment);

              return (
                <React.Fragment key={href}>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    {isLast ? (
                      <BreadcrumbPage>{name}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink asChild>
                        <Link href={href}>{name}</Link>
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                </React.Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      <div className="ml-auto flex items-center gap-2 sm:gap-4">
        <div className="relative w-full max-w-xs hidden sm:block">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search..." className="pl-8 w-full" />
        </div>
         
         <Button variant="ghost" size="icon">
            <Bell className="h-5 w-5" />
            <span className="sr-only">Notifications</span>
        </Button>
        <ThemeToggle />
      </div>
    </header>
  );
}
