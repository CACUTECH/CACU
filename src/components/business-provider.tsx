'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { getBusinessSelectionAction, selectBusinessAction } from '@/app/business-actions';
import { Button } from '@/components/ui/button';
import type { BusinessType } from '@/lib/data';
import Link from 'next/link';
import { gateFor } from '@/lib/two-step';
import { longDate } from '@/lib/closure';

/** The selected business row plus the signed-in member's role. */
export type ActiveBusiness = {
  id: string; name?: string | null; business_type?: BusinessType | null; logo_url?: string | null; userRole?: string;
} & Record<string, unknown>;

interface BusinessContextType {
  business: ActiveBusiness | null;
  loading: boolean;
  refresh: () => Promise<void>;
}
const BusinessContext = createContext<BusinessContextType | undefined>(undefined);
type Selection = Awaited<ReturnType<typeof getBusinessSelectionAction>>;

export function BusinessProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [selection, setSelection] = useState<Selection>({ memberships: [], active: null, twoStep: null, closure: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setSelection({ memberships: [], active: null, twoStep: null, closure: null });
    try {
      const next = await getBusinessSelectionAction();
      if (version !== requestVersion.current) return;
      setSelection(next); setError('');
    } catch {
      if (version === requestVersion.current) setError('Unable to load business memberships. Please retry.');
    } finally { if (version === requestVersion.current) setLoading(false); }
  }, []);
  useEffect(() => {
    const pendingVersion = requestVersion;
    void refresh();
    return () => { pendingVersion.current++; };
  }, [refresh, pathname]);
  const member = selection.active;
  const record = member && (Array.isArray(member.businesses) ? member.businesses[0] : member.businesses);
  const business = record ? { ...record, userRole: member?.role } as ActiveBusiness : null;
  const publicRoute = ['/login', '/login/verify', '/signup', '/verify-email', '/setup', '/forgot-password', '/reset-password', '/join'].includes(pathname);
  // Two-step sign-in (SEC-014): until the session has passed it, the database answers nothing for the business, so say
  // what to do instead of showing empty screens. The setup page stays reachable.
  const gate = !publicRoute && pathname !== '/settings/security' ? gateFor(selection.twoStep) : null;
  const choose = async (id: string) => {
    requestVersion.current++;
    setLoading(true);
    try { await selectBusinessAction(id); window.location.reload(); }
    catch { setLoading(false); setError('Unable to select this business. Refresh your memberships and retry.'); }
  };
  return (
    <BusinessContext.Provider value={{ business, loading, refresh }}>
      {!publicRoute && loading ? <p role="status" className="p-6">Loading business…</p> :
       !publicRoute && error ? <div className="p-6"><p role="alert">{error}</p><Button onClick={() => void refresh()}>Retry</Button></div> :
       gate ? <div className="mx-auto max-w-md space-y-3 p-6"><h1 className="text-xl font-bold">{gate.title}</h1><p>{gate.text}</p>
         <Button asChild><Link href={gate.href}>{gate.action}</Link></Button></div> :
       !publicRoute && selection.memberships.length > 0 && !member ?
       <div className="p-6 space-y-4"><h1 className="text-xl font-bold">Select your business</h1>
         {selection.memberships.map(m => {
           const b = Array.isArray(m.businesses) ? m.businesses[0] : m.businesses;
           return <Button className="mr-2" key={m.business_id} onClick={() => void choose(m.business_id)}>{b?.name ?? m.business_id}</Button>;
         })}
         {error && <p role="alert">{error}</p>}
       </div> : <>
         {!publicRoute && selection.memberships.length > 1 && <div className="p-2 border-b">
           <label htmlFor="active-business" className="mr-2">Active business</label>
           <select id="active-business" className="bg-background text-foreground" value={member?.business_id ?? ''} onChange={e => void choose(e.target.value)}>
             {selection.memberships.map(m => {
               const b = Array.isArray(m.businesses) ? m.businesses[0] : m.businesses;
               return <option key={m.business_id} value={m.business_id}>{b?.name ?? m.business_id}</option>;
             })}
           </select>
         </div>}
         {!publicRoute && selection.closure?.closed && <div role="status" className="border-b bg-amber-50 p-2 text-sm text-amber-900">
           This business is closed, so everything is read-only.{selection.closure.can_reopen && <> <Link className="underline" href="/settings/export">Export your data</Link> or <Link className="underline" href="/settings/close">reopen it</Link> before {longDate(selection.closure.purge_after)}.</>}
         </div>}
         <div key={`${member?.business_id ?? 'public'}:${member?.role ?? 'none'}`}>{children}</div>
       </>}
    </BusinessContext.Provider>
  );
}

/** For components that also render outside a BusinessProvider (signed out, tests): null there. */
export function useOptionalBusiness() {
  return useContext(BusinessContext) ?? null;
}

export function useBusiness() {
  const context = useContext(BusinessContext);
  if (!context) throw new Error('useBusiness must be used within a BusinessProvider');
  return context;
}