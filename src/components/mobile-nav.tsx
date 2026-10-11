'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  MonitorSpeaker,
  FileText,
  Users,
  Settings
} from 'lucide-react';
import { useBusiness } from '@/components/business-provider';
import { cn } from '@/lib/utils';

export function MobileNav() {
  const pathname = usePathname();
  const { business } = useBusiness();
  const service = business?.business_type === 'SERVICE';
  const navItems = [
    { href: '/', label: 'Home', icon: LayoutDashboard },
    { href: service ? '/invoices' : '/pos', label: service ? 'Invoice' : 'Sell', icon: MonitorSpeaker },
    { href: '/customers', label: 'Customers', icon: Users },
    { href: '/reports', label: 'Reports', icon: FileText },
    { href: '/settings', label: 'More', icon: Settings },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-16 items-center justify-around border-t bg-background px-1 pb-safe lg:hidden backdrop-blur-md">
      {navItems.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              "flex min-h-11 min-w-11 flex-col items-center justify-center gap-1 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive ? "text-primary" : "text-muted-foreground"
            )}
          >
            <item.icon className={cn("h-5 w-5", isActive && "scale-110")} />
            <span className="text-[10px] font-medium">
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
