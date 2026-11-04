"use client";

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useBusiness } from '@/components/business-provider';
import { useSubscription } from '@/components/subscription-guard';
import { payRenewalAction } from '@/app/settings/billing/actions';
import { bannerFor } from '@/lib/billing';
import { cn } from '@/lib/utils';

const TONE = { info: 'border-sky-200 bg-sky-50 text-sky-900', warn: 'border-amber-300 bg-amber-50 text-amber-900', bad: 'border-red-300 bg-red-50 text-red-900' } as const;

/** Trial reminders, payment due during grace and the read-only notice, on every page but Billing (Doc 14 SUB-09).
 * Owners and Admins pay the open renewal in one tap; everyone else is told who can. */
export function BillingBanner() {
  const { plan } = useSubscription();
  const { business } = useBusiness();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const banner = plan ? bannerFor(plan) : null;
  if (!banner || pathname === '/settings/billing' || !plan?.subscribed) return null;
  const manager = ['owner', 'admin'].includes(business?.userRole ?? '');
  const renewal = plan.renewal;

  async function pay() {
    setBusy(true); setError('');
    const result = await payRenewalAction();
    if (result.success) { window.location.assign(result.data.authorization_url); return; }
    setBusy(false); setError(result.error);
  }

  return (
    <div role="status" className={cn('mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm', TONE[banner.tone])}>
      <span>{banner.text}{!manager && banner.action === 'pay' && ' Ask the business owner to pay.'}</span>
      {manager && banner.action && (
        banner.action === 'pay' && renewal
          ? <Button size="sm" disabled={busy} onClick={pay}>{busy ? 'Opening Paystack…' : 'Pay now'}</Button>
          : <Button size="sm" asChild><Link href="/settings/billing">{banner.action === 'pay' ? 'Pay now' : 'Choose a plan'}</Link></Button>)}
      {error && <span role="alert" className="w-full">{error}</span>}
    </div>
  );
}
