"use client";
// Remittance schedules for an approved payroll run (E21 R4): PAYE for each state, pension for each PFA, NHF and NHIS,
// each downloadable as a CSV to send with the payment, and who is still missing a state, PFA, tax ID or pension PIN.
import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buildSchedules, payeCsv, pensionCsv, simpleCsv, type RemittanceSchedule } from '@/lib/remittances';

const money = (v: number) => `₦${Number(v).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export function RemittanceSchedules({ schedule }: { schedule: RemittanceSchedule }) {
  const s = React.useMemo(() => buildSchedules(schedule), [schedule]);
  const period = schedule.run.period.slice(0, 7);
  const file = (what: string) => `${what.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${period}.csv`;
  const missing: [string, string[], string][] = [
    ['State taxed in', s.missing.tax_state, 'their PAYE cannot be sent to a state'],
    ['Tax ID', s.missing.tax_id, 'the state cannot credit their PAYE'],
    ['PFA', s.missing.pfa, 'their pension cannot be sent to a PFA'],
    ['Pension PIN', s.missing.pension_pin, 'the PFA cannot credit their pension'],
  ];

  return <Card aria-label="Remittance schedules"><CardHeader><CardTitle>Remittance schedules</CardTitle></CardHeader>
    <CardContent className="space-y-5 text-sm">
      <p className="text-muted-foreground">What to send with each payment, from this run&apos;s payslips. Check each authority&apos;s own upload format before sending.</p>
      {missing.some(([, names]) => names.length > 0) && <div role="note" className="rounded-md border border-amber-500 bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
        <p className="font-medium">Some details are missing</p>
        <ul className="list-disc pl-5">{missing.filter(([, names]) => names.length > 0).map(([field, names, why]) =>
          <li key={field}>{field} not set for {names.join(', ')}: {why}.</li>)}</ul>
        <p className="mt-1">Add them on each <Link href="/hr/employees" className="underline">employee</Link>; the schedules update straight away.</p>
      </div>}

      <section aria-label="PAYE by state" className="space-y-2">
        <p className="font-medium">PAYE, by state</p>
        {s.paye.map(g => <div key={g.to ?? 'none'} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
          <span>{g.to ?? 'State not set'} · {g.rows.length} staff · <span className="tabular-nums">{money(g.total)}</span></span>
          <Button size="sm" variant="outline" onClick={() => download(file(`paye ${g.to ?? 'state not set'}`), payeCsv(period, g))}>Download CSV</Button>
        </div>)}
      </section>

      {s.pension.length > 0 && <section aria-label="Pension by PFA" className="space-y-2">
        <p className="font-medium">Pension, by PFA</p>
        {s.pension.map(g => <div key={g.to ?? 'none'} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
          <span>{g.to ?? 'PFA not set'} · {g.rows.length} staff · <span className="tabular-nums">{money(g.total)}</span></span>
          <Button size="sm" variant="outline" onClick={() => download(file(`pension ${g.to ?? 'pfa not set'}`), pensionCsv(period, g))}>Download CSV</Button>
        </div>)}
      </section>}

      {([['NHF', s.nhf, 'National Housing Fund, to the Federal Mortgage Bank'], ['NHIS', s.nhis, 'Health insurance']] as const).map(([label, rows, title]) =>
        rows.length > 0 && <section key={label} aria-label={label} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
          <span>{title} · {rows.length} staff · <span className="tabular-nums">{money(rows.reduce((t, r) => t + Number(label === 'NHF' ? r.nhf : r.nhis), 0))}</span></span>
          <Button size="sm" variant="outline" onClick={() => download(file(label), simpleCsv(period, label, rows))}>Download CSV</Button>
        </section>)}
    </CardContent></Card>;
}
