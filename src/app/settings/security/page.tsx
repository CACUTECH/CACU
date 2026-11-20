"use client";
// Settings › Two-step sign-in (Doc 16 SEC-014, Doc 10 E22 part 1): add an authenticator app to the password. Optional
// for everyone; required for Owners and Admins on the Chairman plan. Ten recovery codes, shown once, for a lost phone.
import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';
import { getTwoStepStatusAction } from '@/app/business-actions';
import { CODE, cleanCode, recoveryFile, type TwoStepStatus } from '@/lib/two-step';

type Setup = { factorId: string; qr: string; secret: string };

function TwoStep() {
  const supabase = React.useMemo(() => createClient(), []);
  const recovered = useSearchParams()?.get('recovered') === '1';
  const [status, setStatus] = React.useState<TwoStepStatus | null | undefined>(undefined);
  const [setup, setSetup] = React.useState<Setup | null>(null), [code, setCode] = React.useState('');
  const [codes, setCodes] = React.useState<string[] | null>(null);
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [message, setMessage] = React.useState('');

  const load = React.useCallback(async () => { setStatus(await getTwoStepStatusAction()); }, []);
  React.useEffect(() => { void load(); }, [load]);

  const newCodes = async () => {
    const { data, error: rpcError } = await supabase.rpc('new_recovery_codes');
    if (rpcError || !Array.isArray(data)) { setError('Recovery codes could not be made. Try "New recovery codes" again.'); return; }
    setCodes(data as string[]);
  };

  const start = async () => {
    setBusy(true); setError(''); setMessage(''); setCodes(null);
    const { data: listed } = await supabase.auth.mfa.listFactors();
    for (const old of (listed?.all ?? []).filter(f => f.factor_type === 'totp' && f.status !== 'verified')) {
      await supabase.auth.mfa.unenroll({ factorId: old.id });  // an earlier setup that was never finished
    }
    const { data, error: enrolError } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'CACU authenticator' });
    setBusy(false);
    if (enrolError || !data) { setError('Two-step sign-in could not be started. Try again.'); return; }
    setSetup({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  };

  const confirm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!setup) return;
    const value = cleanCode(code);
    if (!CODE.test(value)) { setError('Enter the 6-digit code your app shows for CACU.'); return; }
    setBusy(true); setError('');
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: setup.factorId, code: value });
    if (verifyError) { setBusy(false); setError('That code did not work. Check the time on your phone and try the newest code.'); return; }
    await newCodes();
    setBusy(false); setSetup(null); setCode('');
    setMessage('Two-step sign-in is on. From now on you enter a code from the app after your password.');
    await load();
  };

  const turnOff = async () => {
    if (!window.confirm('Turn off two-step sign-in? Anyone with your password could then sign in as you.')) return;
    setBusy(true); setError(''); setMessage('');
    const { data: listed } = await supabase.auth.mfa.listFactors();
    for (const factor of listed?.all ?? []) {
      const { error: offError } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
      if (offError) { setBusy(false); setError('It could not be turned off. Sign in again with your code, then try once more.'); return; }
    }
    await supabase.auth.refreshSession();
    setBusy(false); setCodes(null); setMessage('Two-step sign-in is off.');
    await load();
  };

  const heading = <div><h1 className="font-headline text-3xl font-bold">Two-step sign-in</h1>
    <p className="text-muted-foreground">After your password, CACU asks for a code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator or similar). Someone who learns your password still cannot get in.</p></div>;
  if (status === undefined) return <div className="space-y-4">{heading}<p role="status">Loading…</p></div>;
  const on = !!status?.enrolled;
  const owesCode = on && status?.level !== 'aal2';

  return <div className="max-w-2xl space-y-6">{heading}
    {recovered && <p role="status" className="rounded-lg bg-amber-50 p-3 text-amber-900">Your lost authenticator was removed. Set up two-step sign-in again on your new phone.</p>}
    {status?.required && !on && <p className="rounded-lg bg-amber-50 p-3 text-amber-900">Your business is on the Chairman plan, which requires Owners and Admins to use two-step sign-in. Set it up to continue.</p>}
    {owesCode ? <p>Two-step sign-in is on. <Link className="underline" href="/login/verify">Enter your code</Link> to change it.</p>
    : on ? <section className="space-y-3 rounded-xl border p-4" aria-label="Two-step sign-in is on">
        <p className="font-medium">On. Recovery codes left: {status?.recovery_codes_left ?? 0}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => void newCodes()}>New recovery codes</Button>
          {status?.required ? <p className="text-sm text-muted-foreground">Your plan requires it, so it cannot be turned off.</p>
            : <Button type="button" variant="outline" disabled={busy} onClick={() => void turnOff()}>Turn off</Button>}
        </div>
      </section>
    : setup ? <form onSubmit={e => void confirm(e)} className="space-y-3 rounded-xl border p-4">
        <p>1. In your authenticator app, add an account and scan this code.</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={setup.qr} alt="QR code to add CACU to your authenticator app" width={180} height={180} className="rounded bg-white p-2" />
        <p className="text-sm">Can&apos;t scan it? Type this key instead: <code aria-label="Setup key" className="break-all rounded bg-muted px-1">{setup.secret}</code></p>
        <div className="space-y-1"><Label htmlFor="setup-code">2. Enter the 6-digit code the app shows</Label>
          <Input id="setup-code" inputMode="numeric" autoComplete="one-time-code" value={code} disabled={busy} onChange={e => setCode(e.target.value)} /></div>
        <Button type="submit" disabled={busy}>{busy ? 'Checking…' : 'Turn on'}</Button>
      </form>
    : <Button type="button" disabled={busy} onClick={() => void start()}>Set up two-step sign-in</Button>}

    {codes && <section className="space-y-3 rounded-xl border border-amber-300 p-4" aria-label="Recovery codes">
      <h2 className="font-semibold">Your recovery codes</h2>
      <p className="text-sm">Keep these somewhere safe, away from your phone. Each one works once if you lose your authenticator app. They are shown only now; earlier codes no longer work.</p>
      <ul className="grid grid-cols-2 gap-1 font-mono">{codes.map(c => <li key={c}>{c}</li>)}</ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => void navigator.clipboard?.writeText(codes.join('\n')).then(() => setMessage('Recovery codes copied.'))}>Copy</Button>
        <Button type="button" variant="outline" asChild><a href={`data:text/plain;charset=utf-8,${encodeURIComponent(recoveryFile(codes))}`} download="cacu-recovery-codes.txt">Download</a></Button>
      </div>
    </section>}
    {message && <p role="status" className="text-emerald-700">{message}</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}

export default function SecurityPage() {
  return <React.Suspense fallback={<p role="status">Loading…</p>}><TwoStep /></React.Suspense>;
}
