"use client";
// Share with a lender (Doc 15 FRA-006..008, FR-184; E19 R3 part 3). The owner names who the pack is for and why, sees
// exactly what will be shared, and confirms. The link is shown once; it stops working when it expires or is
// withdrawn, and every time it is opened is listed here. Owners on the Chairman plan only.
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FundingPackView } from '@/components/funding-pack-view';
import { fundingShareAction, fundingSharePreviewAction, fundingSharesAction, fundingWithdrawAction } from './actions';
import { SHARE_DAYS, showDate, showMoment, type FundingShare, type ShareDraft, type SharePreview } from '@/lib/funding-readiness';

const STATUS: Record<FundingShare['status'], string> = { live: 'Link works', expired: 'Expired', withdrawn: 'Withdrawn' };
const OUTCOME: Record<string, string> = { opened: 'Opened', expired: 'Tried after it expired', withdrawn: 'Tried after you withdrew it',
  switched_off: 'Tried while funding readiness was off' };

export function SharePanel({ assessmentId }: { assessmentId: string }) {
  const [shares, setShares] = React.useState<FundingShare[] | null>(null);
  const [draft, setDraft] = React.useState<ShareDraft>({ recipient_name: '', recipient_organisation: '', purpose: '', expires_in_days: 30 });
  const [preview, setPreview] = React.useState<SharePreview | null>(null);
  const [agreed, setAgreed] = React.useState(false);
  const [made, setMade] = React.useState<FundingShare | null>(null);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const key = React.useRef<string>('');

  const load = React.useCallback(async () => {
    const r = await fundingSharesAction();
    if (r.success) setShares(r.data); else setError(r.error);
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const change = (field: keyof ShareDraft, value: string | number) => { setDraft(d => ({ ...d, [field]: value })); setPreview(null); setAgreed(false); };

  const look = async () => {
    setBusy(true); setError(''); setMade(null);
    try {
      const r = await fundingSharePreviewAction({ ...draft, assessment_id: assessmentId });
      if (r.success) { setPreview(r.data); setAgreed(false); key.current = crypto.randomUUID(); } else setError(r.error);
    } finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!preview || !agreed) return;
    setBusy(true); setError('');
    try {
      const r = await fundingShareAction({ ...draft, assessment_id: assessmentId }, preview.pack_sha256, key.current);
      if (r.success) {
        setMade(r.data); setPreview(null); setAgreed(false);
        setDraft({ recipient_name: '', recipient_organisation: '', purpose: '', expires_in_days: 30 });
        await load();
      } else { setError(r.error); if (/Look at it again/.test(r.error)) setPreview(null); }
    } finally { setBusy(false); }
  };

  const withdraw = async (id: string) => {
    setError('');
    const r = await fundingWithdrawAction(id);
    if (r.success) await load(); else setError(r.error);
  };

  const link = made?.token ? `${window.location.origin}/pack/${made.token}` : null;

  return <section aria-label="Share with a lender" className="space-y-4 rounded-lg border p-4 text-sm">
    <div>
      <p className="text-base font-medium">Share with a lender</p>
      <p className="text-muted-foreground">Send a lender a read-only pack: your management statements for the period, this assessment and how complete
        your records are. They get a link to that pack only, never your books. You choose how long it works and can withdraw it at any time.</p>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}

    {link && <div role="status" className="space-y-2 rounded-md border border-emerald-600 p-3">
      <p className="font-medium">Shared with {made!.recipient_name}. Send them this link:</p>
      <p className="break-all font-mono text-xs">{link}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" onClick={() => void navigator.clipboard?.writeText(link)}>Copy link</Button>
        <p className="text-muted-foreground">CACU shows this link only once. It works until {showDate(made!.expires_at.slice(0, 10))}.</p>
      </div>
    </div>}

    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1"><Label htmlFor="share-name">Who it is for</Label>
        <Input id="share-name" value={draft.recipient_name} maxLength={120} onChange={e => change('recipient_name', e.target.value)} placeholder="Name of the person" /></div>
      <div className="space-y-1"><Label htmlFor="share-org">Their organisation (optional)</Label>
        <Input id="share-org" value={draft.recipient_organisation ?? ''} maxLength={120} onChange={e => change('recipient_organisation', e.target.value)} placeholder="Bank or lender" /></div>
      <div className="space-y-1 sm:col-span-2"><Label htmlFor="share-purpose">What it is for</Label>
        <Input id="share-purpose" value={draft.purpose} maxLength={300} onChange={e => change('purpose', e.target.value)} placeholder="For example, a working capital loan application" /></div>
      <div className="space-y-1"><Label htmlFor="share-days">The link works for</Label>
        <select id="share-days" className="h-9 w-full rounded-md border bg-background px-2" value={draft.expires_in_days}
          onChange={e => change('expires_in_days', Number(e.target.value))}>
          {SHARE_DAYS.map(d => <option key={d} value={d}>{d} days</option>)}
        </select></div>
    </div>
    <Button onClick={() => void look()} disabled={busy || draft.recipient_name.trim().length < 2 || draft.purpose.trim().length < 3}>
      {busy && !preview ? 'Preparing…' : 'See what will be shared'}</Button>

    {preview && <div className="space-y-4">
      <p className="font-medium">This is exactly what {preview.recipient_name} will see:</p>
      <div className="max-h-[32rem] overflow-auto rounded-md border p-4"><FundingPackView pack={preview.pack} /></div>
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-1" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
        <span>I agree to share this pack with {preview.recipient_name}{preview.recipient_organisation ? ` of ${preview.recipient_organisation}` : ''} for
          {' '}&ldquo;{preview.purpose}&rdquo;, for {preview.expires_in_days} days.</span>
      </label>
      <Button onClick={() => void confirm()} disabled={busy || !agreed}>{busy ? 'Sharing…' : 'Share the pack'}</Button>
    </div>}

    {shares && shares.length > 0 && <div className="space-y-2">
      <p className="font-medium">Packs you have shared</p>
      <ul className="space-y-2">{shares.map(s => <li key={s.id} className="rounded-md border p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p><span className="font-medium">{s.recipient_name}</span>{s.recipient_organisation ? `, ${s.recipient_organisation}` : ''}: {s.purpose}</p>
          <p>{STATUS[s.status]}</p>
        </div>
        <p className="text-muted-foreground">Shared {showMoment(s.created_at)}. {s.status === 'withdrawn' && s.withdrawn_at ? `Withdrawn ${showMoment(s.withdrawn_at)}.` :
          `${s.status === 'live' ? 'Works until' : 'Stopped working'} ${showMoment(s.expires_at)}.`} Opened {s.times_opened ?? 0} time{s.times_opened === 1 ? '' : 's'}.</p>
        {s.openings && s.openings.length > 0 && <ul className="mt-1 list-disc pl-5 text-muted-foreground">
          {s.openings.slice(0, 10).map(o => <li key={o.opened_at + o.outcome}>{OUTCOME[o.outcome] ?? o.outcome} {showMoment(o.opened_at)}</li>)}
        </ul>}
        {s.status === 'live' && <Button size="sm" variant="outline" className="mt-2" onClick={() => void withdraw(s.id)}>Withdraw the link</Button>}
      </li>)}</ul>
    </div>}
  </section>;
}
