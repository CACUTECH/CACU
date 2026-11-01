"use client";
import { useCallback, useEffect, useState } from 'react';
import { useBusiness } from '@/components/business-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { decideStockAdjustmentAction, getStockApprovalsAction, saveApprovalPolicyAction } from '@/app/inventory/approval-actions';
import type { ApprovalPolicy, StockAdjustment } from '@/lib/corrections';

const naira = (amount: string) => `NGN ${Number(amount).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

/** Stock changes waiting for an Owner or Admin (FR-080, BR-021), and the Owner's approval rule. */
export function StockApprovals({ revision, onDecided }: { revision: number; onDecided: () => void }) {
  const { business } = useBusiness();
  const role = business?.userRole ?? '', manager = ['owner', 'admin'].includes(role);
  const [data, setData] = useState<{ pending: StockAdjustment[]; policy: ApprovalPolicy } | null>(null), [error, setError] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({}), [busy, setBusy] = useState<string | null>(null);
  const [rule, setRule] = useState({ threshold: '', separation: true }), [ruleSaved, setRuleSaved] = useState('');
  const load = useCallback(async () => {
    const result = await getStockApprovalsAction();
    if (!result.success) { setError(result.error); return; }
    setData(result.data); setError('');
    setRule({ threshold: result.data.policy.stock_threshold ?? '', separation: result.data.policy.separation_of_duties });
  }, []);
  useEffect(() => { void load(); }, [load, revision]);

  async function decide(item: StockAdjustment, approve: boolean) {
    setBusy(item.id); setError('');
    const result = await decideStockAdjustmentAction(item.id, approve, (notes[item.id] ?? '').trim());
    setBusy(null);
    if (!result.success) { setError(result.error); if (result.uncertain) await load(); return; }
    await load(); onDecided();
  }
  async function saveRule(event: React.FormEvent) {
    event.preventDefault(); setRuleSaved(''); setError('');
    const threshold = rule.threshold.trim();
    if (threshold && !/^[0-9]{1,13}(\.[0-9]{1,2})?$/.test(threshold)) { setError('Enter the limit as an amount, for example 50000.'); return; }
    const result = await saveApprovalPolicyAction({ stock_threshold: threshold || null, separation_of_duties: rule.separation });
    if (!result.success) { setError(result.error); return; }
    setRuleSaved('Approval rule saved.'); await load();
  }
  if (!data) return error ? <p role="alert" className="text-destructive">{error}</p> : null;
  const policy = data.policy;
  return <Card><CardHeader><CardTitle>Stock changes waiting for approval</CardTitle></CardHeader><CardContent className="space-y-4">
    <p className="text-sm text-muted-foreground">{policy.stock_threshold === null
      ? 'Owners and Admins post stock changes directly. Changes requested by Editors wait here for an Owner or Admin.'
      : `Changes worth more than ${naira(policy.stock_threshold)}, and all changes requested by Editors, wait here for an Owner or Admin.`}
      {policy.separation_of_duties ? ' Nobody can approve their own request.' : ''}</p>
    {!data.pending.length ? <p className="text-sm">Nothing is waiting.</p> : <ul className="space-y-3">{data.pending.map(item => {
      const selfBlocked = item.mine && policy.separation_of_duties;
      return <li key={item.id} className="space-y-2 rounded-md border p-3">
        <p className="font-medium">{item.item_name}: {item.delta > 0 ? `+${item.delta}` : item.delta} ({naira(item.value)})</p>
        <p className="text-sm">{item.reason} · dated {item.entry_date}{item.mine ? ' · your request' : ''}</p>
        {(manager || item.mine) && <div className="flex flex-wrap items-center gap-2">
          {manager && <Input aria-label={`Note for ${item.item_name}`} className="max-w-xs" placeholder={item.mine ? 'Note (optional)' : 'Note (needed to reject)'} maxLength={500}
            value={notes[item.id] ?? ''} disabled={busy !== null} onChange={e => setNotes(n => ({ ...n, [item.id]: e.target.value }))}/>}
          {manager && !selfBlocked && <Button size="sm" disabled={busy !== null} onClick={() => void decide(item, true)}>Approve and post</Button>}
          {manager && !item.mine && <Button size="sm" variant="outline" disabled={busy !== null || !(notes[item.id] ?? '').trim()} onClick={() => void decide(item, false)}>Reject</Button>}
          {item.mine && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void decide(item, false)}>Withdraw</Button>}
          {selfBlocked && manager && <span className="text-xs text-muted-foreground">Another Owner or Admin must approve this.</span>}
        </div>}
      </li>; })}</ul>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {role === 'owner' && <form onSubmit={saveRule} className="space-y-2 border-t pt-4">
      <p className="text-sm font-medium">Approval rule</p>
      <label className="block space-y-1 text-sm"><span>Owners and Admins need approval above (NGN). Leave blank for no limit.</span>
        <Input inputMode="decimal" className="max-w-xs" value={rule.threshold} onChange={e => setRule(r => ({ ...r, threshold: e.target.value }))}/></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rule.separation} onChange={e => setRule(r => ({ ...r, separation: e.target.checked }))}/>
        Someone other than the requester must approve (turn off only if you run the business alone)</label>
      <Button size="sm" type="submit" variant="outline">Save rule</Button>{ruleSaved && <span role="status" className="ml-2 text-sm">{ruleSaved}</span>}
    </form>}
  </CardContent></Card>;
}
