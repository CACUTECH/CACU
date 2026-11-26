"use client";
// A lender's link to a funding readiness pack (Doc 15 FRA-006..008; E19 R3 part 3). Opens without an account and shows
// only the fixed pack the owner chose to share, never the books. Each opening is logged for the owner (FR-184). An
// unknown, expired or withdrawn link shows nothing of the business.
import * as React from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { FundingPackView } from '@/components/funding-pack-view';
import { showMoment, type PublicPack } from '@/lib/funding-readiness';

const STOPPED: Record<string, string> = {
  expired: 'This link has expired. Ask the business to share a new one if you still need it.',
  withdrawn: 'The business has withdrawn this link.',
  switched_off: 'This pack is not available at the moment.',
};

export default function LenderPackPage() {
  const { token } = useParams<{ token: string }>();
  const [result, setResult] = React.useState<PublicPack | null | undefined>(undefined);
  React.useEffect(() => {
    let live = true;
    if (!/^[0-9a-f]{64}$/.test(token ?? '')) { setResult(null); return; }
    void createClient().rpc('funding_pack', { p_token: token }).then(({ data, error }) => { if (live) setResult(error ? null : (data as PublicPack | null)); },
      () => { if (live) setResult(null); });
    return () => { live = false; };
  }, [token]);

  if (result === undefined) return <main className="mx-auto max-w-3xl p-6"><p role="status">Loading the pack…</p></main>;
  if (result === null || result.status !== 'opened') return <main className="mx-auto max-w-3xl space-y-2 p-6">
    <h1 className="text-xl font-bold">Pack not available</h1>
    <p className="text-muted-foreground">{result ? STOPPED[result.status] : 'This link does not work. It may have been typed wrongly. Ask the business for the link again.'}</p>
  </main>;
  return <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
    <header className="space-y-1">
      <h1 className="font-headline text-2xl font-bold">Funding readiness pack</h1>
      <p>Shared with {result.recipient_name}{result.recipient_organisation ? ` of ${result.recipient_organisation}` : ''} for &ldquo;{result.purpose}&rdquo;.</p>
      <p className="text-sm text-muted-foreground">Shared {showMoment(result.shared_at)}. This link stops working {showMoment(result.expires_at)}. The business can see each time it is opened.</p>
    </header>
    <FundingPackView pack={result.pack} />
    <p className="text-center text-xs text-muted-foreground">Prepared with CACU from the business&apos;s own records.</p>
  </main>;
}
