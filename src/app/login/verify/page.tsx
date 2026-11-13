"use client";
// Second step of sign-in (Doc 16 SEC-014): the 6-digit code from the authenticator app. Without the app, a recovery
// code (with the password already given) removes it so a new one can be set up.
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';
import { CODE, RECOVERY, cleanCode } from '@/lib/two-step';

export default function VerifyPage() {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const [code, setCode] = React.useState(''), [recovery, setRecovery] = React.useState(false);
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = cleanCode(code);
    if (!CODE.test(value)) { setError('Enter the 6-digit code from your authenticator app.'); return; }
    setBusy(true); setError('');
    const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
    const factor = factors?.totp?.[0];
    if (listError || !factor) { setBusy(false); setError('No authenticator is set up for this account. Sign in again.'); return; }
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: value });
    if (verifyError) { setBusy(false); setError('That code did not work. Check the time on your phone and try the newest code.'); return; }
    router.push('/'); router.refresh();
  };

  const recover = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = code.trim();
    if (!RECOVERY.test(value)) { setError('Enter one of your recovery codes, like ABCDE-12345.'); return; }
    setBusy(true); setError('');
    const { data, error: rpcError } = await supabase.rpc('use_recovery_code', { p_code: value });
    setBusy(false);
    if (rpcError) { setError(rpcError.message.includes('TOO_MANY_ATTEMPTS') ? 'Too many tries. Wait an hour, or contact CACU support.' : 'The recovery code could not be checked. Try again.'); return; }
    if (!data) { setError('That recovery code did not work, or it was already used.'); return; }
    await supabase.auth.refreshSession();
    router.push('/settings/security?recovered=1'); router.refresh();
  };

  return <main className="flex min-h-screen items-center justify-center px-4">
    <form onSubmit={e => void (recovery ? recover(e) : verify(e))} className="w-full max-w-sm space-y-4 rounded-xl border p-6">
      <h1 className="text-2xl font-bold">{recovery ? 'Use a recovery code' : 'Enter your sign-in code'}</h1>
      <p className="text-sm text-muted-foreground">{recovery
        ? 'Each recovery code works once. Using one removes your lost authenticator; you then set up a new one.'
        : 'Open your authenticator app and enter the 6-digit code for CACU.'}</p>
      <div className="space-y-1"><Label htmlFor="second-step">{recovery ? 'Recovery code' : 'Code'}</Label>
        <Input id="second-step" value={code} disabled={busy} autoComplete="one-time-code" inputMode={recovery ? 'text' : 'numeric'}
          onChange={e => setCode(e.target.value)} /></div>
      <Button type="submit" className="min-h-11 w-full" disabled={busy}>{busy ? 'Checking…' : 'Continue'}</Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-between text-sm">
        <button type="button" className="underline" onClick={() => { setRecovery(!recovery); setCode(''); setError(''); }}>
          {recovery ? 'Use the authenticator app' : 'Lost your phone? Use a recovery code'}</button>
        <button type="button" className="underline" onClick={() => void supabase.auth.signOut().then(() => router.push('/login'))}>Sign out</button>
      </div>
    </form>
  </main>;
}
