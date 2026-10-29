"use client";
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useHRMutation } from './use-hr-mutation';
import { MutationFeedback } from './mutation-feedback';

export function PayrollCreate({ currentMonth }: { currentMonth: string }) {
  const router = useRouter();
  const [period, setPeriod] = useState(currentMonth);
  const { run, retry, busy, uncertain, error, message, setError } = useHRMutation();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) { setError('Choose a month.'); return; }
    const data = uncertain ? await retry() : await run('payroll.create', { period }, { success: 'Draft payroll created.' });
    if (data) router.push(`/hr/payroll/${data.id}`);
  }
  return <form className="flex flex-wrap items-end gap-3" onSubmit={e => void submit(e)}>
    <label className="space-y-1 text-sm"><span className="block font-medium">Pay month</span>
      <Input type="month" min="2026-01" max={currentMonth} value={period} disabled={busy || uncertain} onChange={e => setPeriod(e.target.value)} /></label>
    <Button type="submit" disabled={busy}>{busy ? 'Calculating...' : uncertain ? 'Retry original request' : 'Create draft payroll'}</Button>
    <div className="basis-full"><MutationFeedback error={error} message={message} uncertain={false} busy={busy} onRetry={() => void retry()} /></div>
  </form>;
}

export function PayrollRunActions({ id, version, reviewed }: { id: string; version: number; reviewed: boolean }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<'approve' | 'cancel' | null>(null);
  const { run, retry, busy, uncertain, error, message } = useHRMutation();
  const locked = busy || uncertain;
  async function act(kind: 'approve' | 'cancel') {
    if (confirm !== kind) { setConfirm(kind); return; }
    const data = await run(kind === 'approve' ? 'payroll.approve' : 'payroll.cancel', {}, { recordId: id, version,
      success: kind === 'approve' ? 'Payroll approved.' : 'Draft cancelled.' });
    setConfirm(null);
    if (data && kind === 'cancel') router.push('/hr/payroll');
  }
  return <div className="space-y-3">
    {!reviewed && <p className="text-sm">This draft used default rules that nobody has reviewed. <Link className="underline" href="/hr/payroll/rules">Review the payroll rules</Link>, then cancel and rebuild this draft before approving.</p>}
    <div className="flex flex-wrap gap-2">
      <Button disabled={locked || !reviewed} onClick={() => void act('approve')}>{confirm === 'approve' ? 'Confirm approval (cannot be undone)' : 'Approve payroll'}</Button>
      <Button variant={confirm === 'cancel' ? 'destructive' : 'outline'} disabled={locked} onClick={() => void act('cancel')}>{confirm === 'cancel' ? 'Confirm cancel draft' : 'Cancel draft'}</Button>
    </div>
    <MutationFeedback error={error} message={message} uncertain={uncertain} busy={busy} onRetry={() => void retry()} />
  </div>;
}
