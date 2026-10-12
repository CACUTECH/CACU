"use client";
import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { invitationLoginPath } from '@/lib/auth-return';
import { acceptInvitationAction } from '@/app/settings/users/actions';
function Accept() {
    const params = useSearchParams();
    const [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const id = params.get('invitation');
    return <div className="mx-auto max-w-lg space-y-4 p-6"><h1 className="text-2xl font-bold">Join your business</h1><p>Sign in with your verified invited email, then accept your invitation. Signing in returns you to this invitation.</p><a className="underline" href={invitationLoginPath(id)}>Sign in</a>{error && <p role="alert">{error}</p>}<Button disabled={busy || !id} onClick={() => { setBusy(true); void acceptInvitationAction(id!).then(() => window.location.assign('/')).catch(e => { setError(e instanceof Error ? e.message : 'Invitation unavailable'); setBusy(false); }); }}>Accept invitation</Button></div>;
}
export default function JoinPage() { return <Suspense fallback={<p>Loading invitation...</p>}><Accept /></Suspense>; }
