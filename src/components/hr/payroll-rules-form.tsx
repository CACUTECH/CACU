"use client";
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { PayrollRules } from '@/lib/hr';
import { useHRMutation } from './use-hr-mutation';
import { MutationFeedback } from './mutation-feedback';

const RATES = [['pension_employee_rate', 'Employee pension'], ['pension_employer_rate', 'Employer pension'],
  ['nhf_rate', 'National Housing Fund (of basic)'], ['rent_relief_rate', 'Rent relief (of declared rent)']] as const;
const percent = (rate: number) => String(Number((rate * 100).toFixed(4)));
const fraction = (value: string) => Number((Number(value) / 100).toFixed(6));
const NUMBER = /^\d{1,13}(\.\d{1,4})?$/;

export function PayrollRulesForm({ rules, version, reviewedAt }: { rules: PayrollRules; version: number; reviewedAt: string | null }) {
  const [bands, setBands] = useState(() => rules.bands.map(b => ({ up_to: b.up_to === null ? '' : String(b.up_to), rate: percent(b.rate) })));
  const [rates, setRates] = useState<Record<string, string>>(() => Object.fromEntries(RATES.map(([key]) => [key, percent(rules[key])])));
  const [cap, setCap] = useState(String(rules.rent_relief_cap));
  const { run, retry, busy, uncertain, error, message, setError } = useHRMutation();
  const locked = busy || uncertain;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (uncertain) { void retry(); return; }
    const values = [...bands.flatMap((b, i) => i === bands.length - 1 ? [b.rate] : [b.up_to, b.rate]), ...Object.values(rates), cap];
    if (values.some(v => !NUMBER.test(v)) || [...bands.map(b => b.rate), ...Object.values(rates)].some(v => Number(v) > 100)) {
      setError('Enter rates between 0 and 100 and amounts as plain numbers.'); return;
    }
    const limits = bands.slice(0, -1).map(b => Number(b.up_to));
    if (limits.some((limit, i) => limit <= (i ? limits[i - 1] : 0))) { setError('Each band limit must be higher than the one before.'); return; }
    const next: PayrollRules = {
      ...(rules.source ? { source: rules.source } : {}),
      bands: bands.map((b, i) => ({ up_to: i === bands.length - 1 ? null : Number(b.up_to), rate: fraction(b.rate) })),
      pension_employee_rate: fraction(rates.pension_employee_rate), pension_employer_rate: fraction(rates.pension_employer_rate),
      nhf_rate: fraction(rates.nhf_rate), rent_relief_rate: fraction(rates.rent_relief_rate), rent_relief_cap: Number(cap),
    };
    void run('payroll.rules', { rules: next }, { version, success: 'Payroll rules confirmed.' });
  }

  return <form className="space-y-6" onSubmit={submit}>
    <Card><CardHeader><CardTitle>Annual PAYE bands</CardTitle>
      <CardDescription>Taxable income is annualised, taxed band by band, then divided by 12. The last band has no upper limit.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        {bands.map((band, i) => <div key={i} className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm"><span>{i === bands.length - 1 ? 'Above the previous limit' : `Band ${i + 1} up to (₦ per year)`}</span>
            <Input disabled={locked || i === bands.length - 1} value={i === bands.length - 1 ? '' : band.up_to} placeholder={i === bands.length - 1 ? 'No limit' : ''}
              onChange={e => setBands(all => all.map((b, j) => j === i ? { ...b, up_to: e.target.value } : b))} /></label>
          <label className="space-y-1 text-sm"><span>Rate (%)</span>
            <Input disabled={locked} value={band.rate} onChange={e => setBands(all => all.map((b, j) => j === i ? { ...b, rate: e.target.value } : b))} /></label>
        </div>)}
      </CardContent>
    </Card>
    <Card><CardHeader><CardTitle>Deductions and relief</CardTitle>
      <CardDescription>Pension is on basic, housing and transport. NHF applies only to employees who opted in.</CardDescription></CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {RATES.map(([key, label]) => <label key={key} className="space-y-1 text-sm"><span>{label} (%)</span>
          <Input disabled={locked} value={rates[key]} onChange={e => setRates(r => ({ ...r, [key]: e.target.value }))} /></label>)}
        <label className="space-y-1 text-sm"><span>Rent relief cap (₦ per year)</span><Input disabled={locked} value={cap} onChange={e => setCap(e.target.value)} /></label>
      </CardContent>
    </Card>
    <p className="text-sm text-muted-foreground">{reviewedAt ? `Last confirmed ${new Date(reviewedAt).toLocaleString('en-NG')}.` : 'These are the unreviewed statutory defaults.'} Confirming records you as the reviewer. Payroll can only be approved on reviewed rules.</p>
    <MutationFeedback error={error} message={message} uncertain={false} busy={busy} onRetry={() => void retry()} />
    <Button type="submit" disabled={busy}>{busy ? 'Saving...' : uncertain ? 'Retry original save' : 'Confirm payroll rules'}</Button>
  </form>;
}
