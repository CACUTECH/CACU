'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { getBusinessSelectionAction, selectBusinessAction } from '@/app/business-actions';
import { Button } from '@/components/ui/button';
import type { BusinessType } from '@/lib/data';

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
  const [selection, setSelection] = useState<Selection>({ memberships: [], active: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setSelection({ memberships: [], active: null });
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
  const publicRoute = ['/login', '/signup', '/verify-email', '/setup', '/forgot-password', '/reset-password', '/join'].includes(pathname);
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
         <div key={`${member?.business_id ?? 'public'}:${member?.role ?? 'none'}`}>{children}</div>
       </>}
    </BusinessContext.Provider>
  );
}

export function useBusiness() {
  const context = useContext(BusinessContext);
  if (!context) throw new Error('useBusiness must be used within a BusinessProvider');
  return context;
}