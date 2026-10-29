"use client";
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { isIsoDate, statusLabel, type EmployeeRecord, type EmployeeStatus } from '@/lib/hr';
import { useHRMutation } from './use-hr-mutation';
import { MutationFeedback } from './mutation-feedback';

export function EmployeeStatusPanel({ employee, today }: { employee: EmployeeRecord; today: string }) {
  const status = employee.employment_status;
  const departed = status === 'exited';
  const [endDate, setEndDate] = useState(today);
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const { run, retry, busy, uncertain, error, message, setError } = useHRMutation();
  const locked = busy || uncertain;
  const options: EmployeeStatus[] = departed ? ['active'] : (['active', 'on_leave', 'suspended'] as const).filter(s => s !== status);

  function depart(event: React.FormEvent) {
    event.preventDefault();
    if (!isIsoDate(endDate) || !reason.trim()) { setError('Enter the last working day and a reason.'); return; }
    if (!confirming) { setConfirming(true); return; }
    void run('employee.depart', { end_date: endDate, reason: reason.trim() }, { recordId: employee.id, version: employee.version, success: 'Departure recorded.' })
      .then(() => setConfirming(false));
  }

  return <Card><CardHeader>
    <CardTitle className="flex items-center gap-3">Employment status <Badge variant={status === 'active' ? 'secondary' : 'outline'}>{statusLabel(status)}</Badge></CardTitle>
    {departed && <CardDescription>Left on {employee.end_date || 'an unrecorded date'}{employee.departure_reason ? `: ${employee.departure_reason}` : ''}</CardDescription>}
  </CardHeader><CardContent className="space-y-4">
    <div className="flex flex-wrap gap-2">
      {options.map(next => <Button key={next} variant="outline" size="sm" disabled={locked}
        onClick={() => void run('employee.status', { status: next }, { recordId: employee.id, version: employee.version, success: `Status changed to ${statusLabel(next)}.` })}>
        {departed ? 'Rehire as active' : `Mark ${statusLabel(next).toLowerCase()}`}</Button>)}
    </div>
    {!departed && <form className="space-y-3 rounded-md border p-3" onSubmit={depart}>
      <h3 className="font-medium">Record departure</h3>
      <label className="block space-y-1 text-sm"><span>Last working day</span>
        <Input type="date" value={endDate} disabled={locked} onChange={e => { setEndDate(e.target.value); setConfirming(false); }} /></label>
      <label className="block space-y-1 text-sm"><span>Reason</span>
        <Textarea maxLength={500} value={reason} disabled={locked} onChange={e => { setReason(e.target.value); setConfirming(false); }} /></label>
      <p className="text-xs text-muted-foreground">Departed employees leave attendance and future payroll. Settle final pay separately. Records are kept, and the employee can be rehired.</p>
      <Button type="submit" variant={confirming ? 'destructive' : 'outline'} disabled={locked}>{confirming ? `Confirm departure of ${employee.full_name}` : 'Record departure'}</Button>
    </form>}
    <MutationFeedback error={error} message={message} uncertain={uncertain} busy={busy} onRetry={() => void retry()} />
  </CardContent></Card>;
}
