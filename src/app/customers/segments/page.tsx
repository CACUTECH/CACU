"use client";
// Customers › Customer segments (Doc 10 CRM; Doc 18 R3 "E06 segments"). Build a rule set on spend, recency, what is
// owed and tags; see who it picks out now; save it, export it, and tag customers. Lifetime value shows on Chairman.
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { deleteSegmentAction, exportSegmentAction, previewSegmentAction, saveSegmentAction, segmentsAction, setTagsAction } from './actions';
import { describe, EMPTY, rulesFrom, type Draft, type Member, type Members, type Overview } from '@/lib/segments';

const money = (v: string) => `₦${Number(v).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

function TagEditor({ member, onSaved }: { member: Member; onSaved: (tags: string[]) => void }) {
  const [editing, setEditing] = React.useState(false), [text, setText] = React.useState(member.tags.join(', ')), [error, setError] = React.useState('');
  if (!editing) return <button className="text-xs underline" onClick={() => setEditing(true)}>{member.tags.length ? member.tags.join(', ') : 'Add tags'}</button>;
  return <span className="flex items-center gap-1">
    <Input aria-label={`Tags for ${member.name}`} className="h-8 w-44" value={text} onChange={e => setText(e.target.value)} />
    <Button type="button" size="sm" onClick={async () => {
      const r = await setTagsAction(member.id, text.split(',').map(t => t.trim()).filter(Boolean));
      if (!r.success) { setError(r.error); return; }
      onSaved(r.data.tags); setEditing(false); setError('');
    }}>Save</Button>{error && <span role="alert" className="text-xs text-destructive">{error}</span>}</span>;
}

export default function SegmentsPage() {
  const [overview, setOverview] = React.useState<Overview | null>(null);
  const [draft, setDraft] = React.useState<Draft>(EMPTY), [name, setName] = React.useState('');
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<Members | null>(null);
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [message, setMessage] = React.useState('');

  const load = React.useCallback(async () => {
    const r = await segmentsAction();
    if (r.success) setOverview(r.data); else setError(r.error);
  }, []);
  React.useEffect(() => { void load(); }, [load]);
  const set = (key: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft(d => ({ ...d, [key]: e.target.value }));

  const look = async () => {
    const rules = rulesFrom(draft);
    if (typeof rules === 'string') { setError(rules); return; }
    setBusy(true); setError('');
    const r = await previewSegmentAction(rules);
    setBusy(false);
    if (r.success) setPreview(r.data); else setError(r.error);
  };
  const save = async () => {
    const rules = rulesFrom(draft);
    if (typeof rules === 'string') { setError(rules); return; }
    if (!name.trim()) { setError('Give the segment a name.'); return; }
    setBusy(true); setError(''); setMessage('');
    const r = await saveSegmentAction(editingId ?? crypto.randomUUID(), name.trim(), rules);
    setBusy(false);
    if (!r.success) { setError(r.error); return; }
    setPreview(r.data); setEditingId(r.data.id); setMessage(`Segment "${name.trim()}" saved.`); await load();
  };
  const open = (id: string) => {
    const s = overview?.segments.find(x => x.id === id); if (!s) return;
    const r = s.rules;
    setDraft({ spentAmount: r.spent_at_least?.amount ?? '', spentDays: String(r.spent_at_least?.days ?? 90), underAmount: r.spent_less_than?.amount ?? '',
      underDays: String(r.spent_less_than?.days ?? 90), quietDays: r.no_purchase_for ? String(r.no_purchase_for.days) : '', recentDays: r.bought_within ? String(r.bought_within.days) : '',
      owes: r.owes_at_least ?? '', tags: (r.tags_any ?? []).join(', ') });
    setName(s.name); setEditingId(s.id); setPreview(null); setMessage('');
  };
  const download = async (id: string, label: string) => {
    const r = await exportSegmentAction(id);
    if (!r.success) { setError(r.error); return; }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([r.data], { type: 'text/csv' })); link.download = `${label.replace(/[^\w-]+/g, '-').toLowerCase()}.csv`;
    link.click(); URL.revokeObjectURL(link.href);
  };

  return <div className="max-w-4xl space-y-6">
    <div><h1 className="font-headline text-3xl font-bold">Customer segments</h1>
      <p className="text-muted-foreground">Group customers by what they buy, when they last bought, what they owe and their tags.</p></div>
    {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-800">{message}</p>}
    {overview && overview.segments.length > 0 && <section aria-label="Saved segments" className="rounded-xl border p-4">
      <h2 className="mb-2 font-semibold">Saved segments</h2>
      <ul className="divide-y text-sm">{overview.segments.map(s => <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
        <span><strong>{s.name}</strong> · {s.customers} customer{s.customers === 1 ? '' : 's'} · {describe(s.rules)}</span>
        <span className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => open(s.id)}>Open</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => void download(s.id, s.name)}>Export</Button>
          <Button type="button" size="sm" variant="ghost" onClick={async () => { const r = await deleteSegmentAction(s.id); if (r.success) setOverview(r.data); else setError(r.error); }}>Delete</Button></span>
      </li>)}</ul></section>}

    <section aria-label="Rules" className="space-y-3 rounded-xl border p-4">
      <h2 className="font-semibold">{editingId ? 'Change the segment' : 'New segment'}</h2>
      <p className="text-sm text-muted-foreground">Fill in only the rules you want. A customer must meet every one.</p>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <label className="space-y-1"><span>Spent at least (₦)</span><span className="flex gap-2"><Input aria-label="Spent at least" value={draft.spentAmount} onChange={set('spentAmount')} />
          <Input aria-label="Spent at least, in the last days" className="w-20" value={draft.spentDays} onChange={set('spentDays')} /><span className="self-center">days</span></span></label>
        <label className="space-y-1"><span>Spent less than (₦)</span><span className="flex gap-2"><Input aria-label="Spent less than" value={draft.underAmount} onChange={set('underAmount')} />
          <Input aria-label="Spent less than, in the last days" className="w-20" value={draft.underDays} onChange={set('underDays')} /><span className="self-center">days</span></span></label>
        <label className="space-y-1"><span>No purchase for (days)</span><Input aria-label="No purchase for" value={draft.quietDays} onChange={set('quietDays')} /></label>
        <label className="space-y-1"><span>Bought in the last (days)</span><Input aria-label="Bought in the last" value={draft.recentDays} onChange={set('recentDays')} /></label>
        <label className="space-y-1"><span>Owes at least (₦)</span><Input aria-label="Owes at least" value={draft.owes} onChange={set('owes')} /></label>
        <label className="space-y-1"><span>Tagged (any of, separated by commas)</span><Input aria-label="Tagged" value={draft.tags} onChange={set('tags')} placeholder={overview?.tags.slice(0, 3).join(', ')} /></label>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={() => void look()}>See who is in it</Button>
        <div className="space-y-1"><Label htmlFor="segment-name">Name</Label><Input id="segment-name" value={name} maxLength={80} onChange={e => setName(e.target.value)} /></div>
        <Button type="button" disabled={busy} onClick={() => void save()}>{editingId ? 'Save changes' : 'Save segment'}</Button>
        {editingId && <Button type="button" variant="ghost" onClick={() => { setEditingId(null); setDraft(EMPTY); setName(''); setPreview(null); }}>New instead</Button>}
      </div>
    </section>
    {error && <p role="alert" className="text-destructive">{error}</p>}

    {preview && <section aria-label="Customers in the segment" className="space-y-2">
      <h2 className="font-semibold">{preview.count} customer{preview.count === 1 ? '' : 's'}</h2>
      <div className="overflow-x-auto rounded-xl border"><table className="w-full text-sm">
        <thead><tr className="border-b text-left"><th className="p-2">Customer</th><th className="p-2">Last bought</th><th className="p-2 text-right">Spent (90 days)</th>
          <th className="p-2 text-right">Owes</th>{preview.lifetime_value && <th className="p-2 text-right">Lifetime value</th>}<th className="p-2">Tags</th></tr></thead>
        <tbody>{preview.customers.map(c => <tr key={c.id} className="border-b">
          <td className="p-2">{c.name}{c.phone ? <span className="block text-xs text-muted-foreground">{c.phone}</span> : null}</td>
          <td className="p-2">{c.last_purchase ? `${c.last_purchase} (${c.days_since} day${c.days_since === 1 ? '' : 's'} ago)` : 'Never'}</td>
          <td className="p-2 text-right">{money(c.spent_90_days)}</td><td className="p-2 text-right">{money(c.owes)}</td>
          {preview.lifetime_value && <td className="p-2 text-right">{money(c.lifetime_value ?? '0')}</td>}
          <td className="p-2"><TagEditor member={c} onSaved={tags => setPreview(p => p && { ...p, customers: p.customers.map(x => x.id === c.id ? { ...x, tags } : x) })} /></td>
        </tr>)}</tbody></table></div>
      {!preview.lifetime_value && <p className="text-xs text-muted-foreground">Lifetime value is part of the Chairman plan.</p>}
    </section>}
  </div>;
}
