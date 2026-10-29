"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { naira, type EmployeeRecord } from '@/lib/hr';
import { useHRMutation } from './use-hr-mutation';
import { MutationFeedback } from './mutation-feedback';

const TEXT = ['full_name', 'job_title', 'department', 'email', 'phone', 'start_date', 'tax_id', 'pension_pin'] as const;
const AMOUNTS = ['pay_basic', 'pay_housing', 'pay_transport', 'pay_other', 'annual_rent', 'nhis_monthly'] as const;
const AMOUNT = /^\d{1,13}(\.\d{1,2})?$/;

function initial(employee?: EmployeeRecord | null) {
  const fields: Record<string, string> = {};
  for (const key of [...TEXT, ...AMOUNTS]) {
    const value = employee?.[key];
    fields[key] = value === null || value === undefined ? (AMOUNTS.includes(key as never) && key !== 'pay_basic' ? '0' : '') : String(value);
  }
  return fields;
}

export function EmployeeForm({ employee }: { employee?: EmployeeRecord | null }) {
  const router = useRouter();
  const [fields, setFields] = useState(() => initial(employee));
  const [pension, setPension] = useState(employee?.pension_enrolled ?? true);
  const [nhf, setNhf] = useState(employee?.nhf_enrolled ?? false);
  const { run, retry, busy, uncertain, error, message, setError } = useHRMutation();
  const locked = busy || uncertain;
  const gross = fields.pay_basic === '' ? null : AMOUNTS.slice(0, 4).reduce((sum, key) => sum + (Number(fields[key]) || 0), 0);

  function details() {
    const result: Record<string, unknown> = { pension_enrolled: pension, nhf_enrolled: nhf };
    for (const key of TEXT) result[key] = key === 'start_date' ? fields[key] || null : fields[key].trim();
    for (const key of AMOUNTS) result[key] = key === 'pay_basic' && fields[key] === '' ? null : fields[key];
    return result;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (uncertain) { const data = await retry(); if (data && !employee) router.push(`/hr/employees/${data.id}`); return; }
    if (!fields.full_name.trim()) { setError('Enter the employee name.'); return; }
    const bad = AMOUNTS.find(key => !(key === 'pay_basic' && fields[key] === '') && !AMOUNT.test(fields[key]));
    if (bad) { setError('Amounts must be zero or more with at most two decimal places.'); return; }
    const data = await run('employee.save', details(), { recordId: employee?.id, version: employee?.version, success: 'Employee saved.' });
    if (data && !employee) router.push(`/hr/employees/${data.id}`);
  }

  function field(name: string, label: string, type = 'text', hint?: string) {
    return <label className="space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      <Input name={name} type={type} inputMode={AMOUNTS.includes(name as never) ? 'decimal' : undefined} disabled={locked} value={fields[name]}
        required={name === 'full_name'} onChange={e => setFields(f => ({ ...f, [name]: e.target.value }))} />
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>;
  }

  return <form className="space-y-6" onSubmit={e => void submit(e)}>
    <Card><CardHeader><CardTitle>Personal and job details</CardTitle></CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        {field('full_name', 'Full name')}{field('job_title', 'Job title')}{field('department', 'Department')}
        {field('start_date', 'Start date', 'date')}{field('email', 'Email', 'email')}{field('phone', 'Phone', 'tel')}
      </CardContent>
    </Card>
    <Card><CardHeader><CardTitle>Monthly pay</CardTitle>
      <CardDescription>Leave basic pay empty if this employee is not on payroll. Pension is calculated on basic, housing and transport.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {field('pay_basic', 'Basic (₦)')}{field('pay_housing', 'Housing (₦)')}{field('pay_transport', 'Transport (₦)')}{field('pay_other', 'Other allowances (₦)')}
        </div>
        <p className="text-sm">Monthly gross: <strong>{gross === null ? 'Not on payroll' : naira(gross)}</strong></p>
      </CardContent>
    </Card>
    <Card><CardHeader><CardTitle>Tax and statutory deductions</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {field('annual_rent', 'Declared annual rent (₦)', 'text', 'Rent relief applies only to declared rent.')}
          {field('nhis_monthly', 'Health insurance (NHIS) per month (₦)')}
          {field('tax_id', 'Tax ID')}{field('pension_pin', 'Pension PIN')}
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pension} disabled={locked} onChange={e => setPension(e.target.checked)} /> Contributory pension</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={nhf} disabled={locked} onChange={e => setNhf(e.target.checked)} /> National Housing Fund (opted in)</label>
      </CardContent>
    </Card>
    <MutationFeedback error={error} message={message} uncertain={false} busy={busy} onRetry={() => void retry()} />
    <Button type="submit" disabled={busy}>{busy ? 'Saving...' : uncertain ? 'Retry original save' : employee ? 'Save changes' : 'Add employee'}</Button>
    {uncertain && <p className="text-sm">Retry sends the original details. Refresh the page to discard them.</p>}
  </form>;
}
