"use client";
// Where an employee's deductions go (E21 R4): the state they are taxed in (their PAYE goes to that state's revenue
// service) and their Pension Fund Administrator. Used to build the remittance schedules for each payroll run.
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { saveRemittanceDetailsAction } from '@/app/hr/actions';
import { TAX_STATES, type RemittanceDetails, type TaxState } from '@/lib/remittances';

export function RemittanceDetailsForm({ employeeId, details }: { employeeId: string; details: RemittanceDetails }) {
  const [state, setState] = React.useState<string>(details.tax_state ?? '');
  const [pfa, setPfa] = React.useState(details.pfa ?? '');
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMessage(null);
    try {
      const r = await saveRemittanceDetailsAction(employeeId, { tax_state: (state || null) as TaxState | null, pfa: pfa.trim() || null });
      setMessage(r.success ? { ok: true, text: 'Saved.' } : { ok: false, text: r.error });
    } finally { setBusy(false); }
  };

  return <Card><CardHeader><CardTitle>Where deductions go</CardTitle></CardHeader><CardContent>
    <form onSubmit={e => void save(e)} className="grid gap-3 text-sm sm:grid-cols-2" aria-label="Where deductions go">
      <p className="text-muted-foreground sm:col-span-2">PAYE is paid to the revenue service of the state the employee lives in. Pension is paid to their Pension Fund Administrator (PFA).</p>
      <div className="space-y-1"><Label htmlFor="tax-state">State taxed in</Label>
        <select id="tax-state" className="h-9 w-full rounded-md border bg-background px-2" value={state} onChange={e => setState(e.target.value)}>
          <option value="">Not set</option>
          {TAX_STATES.map(s => <option key={s} value={s}>{s === 'FCT' ? 'FCT (Abuja)' : s}</option>)}
        </select></div>
      <div className="space-y-1"><Label htmlFor="pfa">Pension Fund Administrator</Label>
        <Input id="pfa" value={pfa} maxLength={80} placeholder="As on the employee's pension statement" onChange={e => setPfa(e.target.value)} /></div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        {message && <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'text-muted-foreground' : 'text-destructive'}>{message.text}</p>}
      </div>
    </form>
  </CardContent></Card>;
}
