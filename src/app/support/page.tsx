"use client";
// Support cases (Doc 10 E22 part 4): for CACU's support people only. Lists the businesses whose Owner has let support
// look now; opening one is recorded and shown to the Owner. Read-only.
import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { openSupportCaseAction, supportCasesAction } from '@/app/support/actions';
import { dateTime, type SupportCases } from '@/lib/support-access';

export default function SupportCasesPage() {
  const [cases, setCases] = React.useState<SupportCases | null | undefined>(undefined);
  const [busy, setBusy] = React.useState(''), [error, setError] = React.useState('');

  React.useEffect(() => { void supportCasesAction().then(r => setCases(r.success ? r.data : null)); }, []);

  const open = async (businessId: string) => {
    setBusy(businessId); setError('');
    const r = await openSupportCaseAction(businessId);
    if (!r.success) { setBusy(''); setError(r.error); return; }
    window.location.assign('/');
  };

  const heading = <div><h1 className="font-headline text-3xl font-bold">Support cases</h1>
    <p className="text-muted-foreground">Businesses whose owner has let CACU support look, for now.</p></div>;
  if (cases === undefined) return <div className="space-y-4 p-6">{heading}<p role="status">Loading…</p></div>;
  if (!cases?.staff) return <div className="space-y-4 p-6">{heading}<p>This page is for CACU support staff.</p></div>;
  if (!cases.two_step) return <div className="space-y-4 p-6">{heading}
    <p>Support access needs two-step sign-in. Sign in with your authenticator app first.</p>
    <Button asChild><Link href="/settings/security">Two-step sign-in</Link></Button></div>;

  return <div className="max-w-3xl space-y-4 p-6">{heading}
    <p className="text-sm">You can read but not change anything. Each time you open a business, its owner sees your name and the time.</p>
    {cases.cases.length === 0 ? <p>No business has granted support access right now.</p> :
      <ul className="divide-y rounded-xl border">{cases.cases.map(c =>
        <li key={c.business_id} className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div><p className="font-medium">{c.name}</p>
            <p className="text-sm">{c.reason}</p>
            <p className="text-sm text-muted-foreground">Until {dateTime(c.expires_at)} · {c.include_pay ? 'Staff and pay records included' : 'Staff and pay records hidden'}</p></div>
          <Button type="button" disabled={!!busy} onClick={() => void open(c.business_id)}>
            {busy === c.business_id ? 'Opening…' : c.opened ? 'Open again' : 'Open'}</Button>
        </li>)}</ul>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}
