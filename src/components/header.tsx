
"use client";

import React from 'react';
import { usePathname } from 'next/navigation';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import Link from 'next/link';
import { Button } from './ui/button';
import { Bell, Sun, Moon, Search, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { Input } from './ui/input';
import { useTheme } from "@/components/theme-provider";
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { ScrollArea } from './ui/scroll-area';
import { Badge } from './ui/badge';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

const breadcrumbNameMap: { [key: string]: string } = {
  '/': 'Dashboard',
  '/pos': 'POS Checkout',
  '/transactions': 'Transactions',
  '/invoices': 'Invoices',
  '/inventory': 'Inventory',
  '/storefront': 'Storefront',
  '/reports': 'Reports',
  '/customers': 'Customers',
  '/settings': 'Settings',
  '/support': 'Support',
  '/analytics': 'Analytics',
  '/credit': 'Credit',
  '/hr': 'HR',
  '/apps': 'Integrations',
  '/setup': 'Setup',
  '/accounting': 'Accounting',
  '/accounting/chart-of-accounts': 'Chart of Accounts',
  '/accounting/journal-entries': 'Journal Adjustments',
  '/accounting/trial-balance': 'Trial Balance',
};

function NotificationBell() {
  const [notifications, setNotifications] = React.useState<any[]>([]);
  const supabase = createClient();

  const fetchNotifications = React.useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('notifications')
      .select('*, type:event_type, message:body')
      .eq('user_id', user.id)
      .is('read_at', null)
      .order('created_at', { ascending: false });
    
    setNotifications(data || []);
  }, [supabase]);

  React.useEffect(() => {
    fetchNotifications();
    
    // Set up real-time listener
    const channel = supabase
      .channel('realtime_notifications')
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'notifications' 
      }, () => {
        fetchNotifications();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, fetchNotifications]);

  const markAsRead = async (id: string) => {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const unreadCount = notifications.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute top-2 right-2 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="p-4 border-b flex items-center justify-between">
          <h4 className="font-bold text-sm">Notifications</h4>
          <Badge variant="secondary" className="text-[10px]">{unreadCount} New</Badge>
        </div>
        <ScrollArea className="h-72">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-12 text-muted-foreground">
              <Bell className="h-8 w-8 opacity-10 mb-2" />
              <p className="text-xs">No new alerts</p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((n) => (
                <div key={n.id} className="p-4 hover:bg-muted/50 transition-colors group">
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "mt-1 p-1.5 rounded-lg",
                      n.type === 'LOW_STOCK' ? "bg-amber-100 text-amber-700" :
                      n.type === 'PAYMENT_RECEIVED' ? "bg-emerald-100 text-emerald-700" :
                      "bg-primary/10 text-primary"
                    )}>
                      {n.type === 'LOW_STOCK' ? <AlertTriangle className="h-3 w-3" /> :
                       n.type === 'PAYMENT_RECEIVED' ? <CheckCircle2 className="h-3 w-3" /> :
                       <Info className="h-3 w-3" />}
                    </div>
                    <div className="flex-1 space-y-1">
                      <p className="text-xs font-bold leading-none">{n.title}</p>
                      <p className="text-[10px] text-muted-foreground leading-tight">{n.message}</p>
                      <p className="text-[9px] text-muted-foreground/60">{format(new Date(n.created_at), 'h:mm a')}</p>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-6 w-6 opacity-0 group-hover:opacity-100"
                      onClick={() => markAsRead(n.id)}
                    >
                      <CheckCircle2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
        <div className="p-2 border-t text-center">
          <Button variant="link" size="sm" className="text-[10px] h-auto p-0">View all history</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

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
            <Input placeholder="Search..." className="pl-8 w-full h-9 rounded-xl" />
        </div>
         
        <NotificationBell />
        <ThemeToggle />
      </div>
    </header>
  );
}
