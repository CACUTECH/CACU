"use client";
// A payslip link (E21 R4): opens without an account and shows one approved payslip: pay, deductions and net pay, with
// the tax ID and pension PIN partly hidden. A withdrawn, expired or unknown link shows nothing.
import * as React from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { TOKEN_PATTERN, type PublicPayslip } from '@/lib/payslips';

const money = (value: number | string | null) => `₦${Number(value ?? 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const month = (period: string) => new Date(`${period.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-NG', { month: 'long', year: 'numeric' });

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return <tr className={strong ? 'font-bold' : undefined}><td className="py-0.5">{label}</td><td className="py-0.5 text-right tabular-nums">{money(value)}</td></tr>;
}

export default function PublicPayslipPage() {
  const { token } = useParams<{ token: string }>();
  const [slip, setSlip] = React.useState<PublicPayslip | null | undefined>(undefined);
  React.useEffect(() => {
    let live = true;
    if (!TOKEN_PATTERN.test(token ?? '')) { setSlip(null); return; }
    void createClient().rpc('public_payslip', { p_token: token }).then(({ data, error }) => { if (live) setSlip(error ? null : (data as PublicPayslip | null)); },
      () => { if (live) setSlip(null); });
    return () => { live = false; };
  }, [token]);

  if (slip === undefined) return <main className="mx-auto max-w-md p-6"><p role="status">Loading payslip…</p></main>;
  if (slip === null) return <main className="mx-auto max-w-md space-y-2 p-6"><h1 className="text-xl font-bold">Payslip not available</h1>
    <p className="text-muted-foreground">This link does not work. It may have expired, been typed wrongly, or been withdrawn by your employer. Ask them for a new one.</p></main>;
  const e = slip.employee, earn = slip.earnings, ded = slip.deductions;
  const deducted = Number(ded.paye) + Number(ded.pension) + Number(ded.nhf) + Number(ded.nhis);
  return <main className="mx-auto max-w-md p-4">
    <article aria-label="Payslip" className="space-y-4 rounded-lg border bg-white p-4 text-sm text-black">
      <header>
        <h1 className="text-lg font-bold">{slip.business.name}</h1>
        {slip.business.address && <p>{slip.business.address}</p>}
        <p className="mt-2 font-medium">Payslip for {month(slip.period)}</p>
      </header>
      <section aria-label="Employee">
        <p className="font-medium">{e.name}</p>
        {e.job_title && <p>{e.job_title}</p>}
        <dl className="mt-1 grid grid-cols-2 gap-x-3 text-xs">
          {e.tax_id && <><dt>Tax ID</dt><dd>{e.tax_id}</dd></>}
          {e.tax_state && <><dt>State taxed in</dt><dd>{e.tax_state === 'FCT' ? 'FCT (Abuja)' : e.tax_state}</dd></>}
          {e.pension_pin && <><dt>Pension PIN</dt><dd>{e.pension_pin}</dd></>}
          {e.pfa && <><dt>PFA</dt><dd>{e.pfa}</dd></>}
        </dl>
      </section>
      <table aria-label="Earnings" className="w-full"><tbody>
        <Row label="Basic" value={earn.basic} />
        {Number(earn.housing) > 0 && <Row label="Housing" value={earn.housing} />}
        {Number(earn.transport) > 0 && <Row label="Transport" value={earn.transport} />}
        {Number(earn.other) > 0 && <Row label="Other allowances" value={earn.other} />}
        <Row label="Gross pay" value={earn.gross} strong />
      </tbody></table>
      <table aria-label="Deductions" className="w-full"><tbody>
        <Row label="PAYE tax" value={ded.paye} />
        {Number(ded.pension) > 0 && <Row label="Pension (your share)" value={ded.pension} />}
        {Number(ded.nhf) > 0 && <Row label="National Housing Fund" value={ded.nhf} />}
        {Number(ded.nhis) > 0 && <Row label="Health insurance" value={ded.nhis} />}
        <Row label="Total deductions" value={deducted} strong />
      </tbody></table>
      <p className="flex justify-between border-t border-black pt-2 text-base font-bold"><span>Net pay</span><span className="tabular-nums">{money(slip.net)}</span></p>
      {Number(slip.employer_pension) > 0 && <p className="text-xs">Your employer also pays {money(slip.employer_pension)} into your pension. Taxable pay for the year: {money(slip.taxable_annual)}.</p>}
    </article>
    <p className="mt-3 text-center text-xs text-muted-foreground">Sent by {slip.business.name} using CACU. This link works until {new Date(slip.expires_at).toLocaleDateString('en-NG')}.</p>
  </main>;
}
