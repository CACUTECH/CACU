"use client";
// Credit notes (Doc 10 E12, Doc 09 PR-16): every credit note on the business's invoices. Those waiting are approved or
// rejected here by an Owner or Admin; whoever asked can withdraw their own. Start one from an invoice's menu.
import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { creditNotesAction, decideCreditNoteAction } from '@/app/invoices/credit-note-actions';
import { CREDIT_STATUS, naira, type CreditNote, type CreditNoteList, type CreditStatus } from '@/lib/credit-notes';

const TABS: { key: CreditStatus; label: string }[] = [{ key: 'pending', label: 'Waiting' }, { key: 'posted', label: 'Posted' }, { key: 'rejected', label: 'Rejected' }];

function Decide({ credit, canApprove, onDone }: { credit: CreditNote; canApprove: boolean; onDone: (message: string) => void }) {
  const [note, setNote] = React.useState(''), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const act = async (approve: boolean) => {
    if (!approve && !credit.mine && note.trim().length === 0) { setError('Say why the credit note is rejected.'); return; }
    setBusy(true); setError('');
    const r = await decideCreditNoteAction(credit.id, approve, note.trim());
    setBusy(false);
    if (!r.success) { setError(r.error); return; }
    onDone(approve ? `${r.data.number} posted: ${naira(r.data.amount)} off ${r.data.invoice_number}.` : `${r.data.number} ${credit.mine && !note.trim() ? 'withdrawn' : 'rejected'}.`);
  };
  return <div className="space-y-2">
    {canApprove && <Input aria-label={`Note for ${credit.number}`} placeholder="Note (needed to reject)" value={note} maxLength={500} disabled={busy} onChange={e => setNote(e.target.value)} />}
    <div className="flex flex-wrap gap-2">
      {canApprove && !credit.mine && <Button type="button" size="sm" disabled={busy} onClick={() => void act(true)}>Approve and post</Button>}
      {canApprove && !credit.mine && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void act(false)}>Reject</Button>}
      {credit.mine && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void act(false)}>Withdraw</Button>}
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}

export default function CreditNotesPage() {
  const [tab, setTab] = React.useState<CreditStatus>('pending');
  const [list, setList] = React.useState<CreditNoteList | null>(null);
  const [error, setError] = React.useState(''), [message, setMessage] = React.useState('');

  const load = React.useCallback(async (status: CreditStatus) => {
    setList(null); setError('');
    const r = await creditNotesAction(status);
    if (r.success) setList(r.data); else setError(r.error);
  }, []);
  React.useEffect(() => { void load(tab); }, [tab, load]);

  return <div className="max-w-4xl space-y-6">
    <div className="space-y-1">
      <Link href="/invoices" className="text-sm text-muted-foreground hover:underline">← Invoices</Link>
      <h1 className="font-headline text-3xl font-bold">Credit notes</h1>
      <p className="text-muted-foreground">Goods given back or amounts taken off issued invoices. Start one from an invoice&apos;s menu.</p>
    </div>
    <div role="tablist" className="flex gap-2">
      {TABS.map(t => <Button key={t.key} type="button" role="tab" aria-selected={tab === t.key} variant={tab === t.key ? 'default' : 'outline'} onClick={() => { setMessage(''); setTab(t.key); }}>{t.label}</Button>)}
    </div>
    {message && <p role="status" className="text-emerald-700">{message}</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!list && !error && <p role="status">Loading…</p>}
    {list && (list.credit_notes.length === 0 ? <p className="text-sm text-muted-foreground">{tab === 'pending' ? 'Nothing is waiting for approval.' : 'None yet.'}</p>
      : <ul className="space-y-3">{list.credit_notes.map(c => <li key={c.id} className="space-y-2 rounded-xl border p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-semibold">{c.number} · {c.invoice_number}{c.customer_name ? ` · ${c.customer_name}` : ''}</p>
          <p className="font-semibold">{naira(c.amount)}</p>
        </div>
        <p className="text-sm">{c.items} · {c.reason}</p>
        <p className="text-xs text-muted-foreground">{CREDIT_STATUS[c.status]} · asked by {c.requested_by_name} on {c.requested_at.slice(0, 10)}{c.decided_on ? `, decided ${c.decided_on}` : ''}{c.decision_note ? `: ${c.decision_note}` : ''}</p>
        {c.status === 'posted' && Number(c.to_advance) > 0 && <p className="text-sm">{naira(c.against_invoice ?? 0)} off the invoice; {naira(c.to_advance ?? 0)} kept as the customer&apos;s advance. <Link className="underline" href={`/invoices/statement?customer=${c.customer_id}`}>Customer statement</Link></p>}
        {c.status === 'pending' && <Decide credit={c} canApprove={list.can_approve} onDone={m => { setMessage(m); void load(tab); }} />}
      </li>)}</ul>)}
  </div>;
}
