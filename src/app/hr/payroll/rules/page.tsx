import Link from 'next/link';
import { HRService } from '@/services/hr-service';
import { PayrollRulesForm } from '@/components/hr/payroll-rules-form';

export default async function PayrollRulesPage() {
  let saved;
  try { saved = await new HRService().payrollRules(); }
  catch { return <div role="alert">Payroll rules could not be loaded. <Link href="/hr/payroll/rules">Retry</Link></div>; }
  return <div className="mx-auto max-w-3xl space-y-6">
    <Link href="/hr/payroll" className="text-sm underline">Back to payroll</Link>
    <h1 className="font-headline text-3xl font-bold">Payroll rules</h1>
    <p className="text-sm text-muted-foreground">Defaults follow the Nigeria Tax Act 2025 (from 1 January 2026), the Pension Reform Act 2014 and the National Housing Fund.
      Check them with your tax adviser or the state revenue service before approving payroll. Each run keeps a copy of the rules it used.</p>
    <PayrollRulesForm key={saved.version} rules={saved.rules} version={saved.version} reviewedAt={saved.reviewed_at} />
  </div>;
}
