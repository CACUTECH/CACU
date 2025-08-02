"use client";

import React from 'react';
import { usePathname } from 'next/navigation';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import Link from 'next/link';
import { Button } from './ui/button';
import { PlusCircle } from 'lucide-react';

const breadcrumbNameMap: { [key: string]: string } = {
  '/': 'Dashboard',
  '/transactions': 'Transactions',
  '/inventory': 'Inventory',
  '/reports': 'Reports',
  '/settings': 'Settings',
  '/community': 'Community',
  '/analytics': 'Analytics',
  '/credit': 'Credit',
  '/hr': 'HR',
  '/apps': 'Apps',
  '/setup': 'Setup',
};

export function Header() {
  const pathname = usePathname();
  const pathSegments = pathname.split('/').filter(Boolean);

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b bg-background/80 px-4 backdrop-blur-sm sm:h-16 sm:px-6">
      <div className="flex items-center gap-2 md:hidden">
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
              const name = breadcrumbNameMap[href] || segment.charAt(0).toUpperCase() + segment.slice(1);

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

      <div className="ml-auto">
        <Button size="sm">
            <PlusCircle className="mr-2 h-4 w-4" />
            Add Transaction
        </Button>
      </div>
    </header>
  );
}
