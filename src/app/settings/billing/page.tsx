"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useBusiness } from '@/components/business-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { VAT_NOTE, cardLine, highlights, naira, nextStep, overLimitNotes, planAction, planLine, price, renewalLine, returnedReference, statusOf, usageLines,
  type BillingInterval, type BillingInvoice, type CurrentPlan, type Plan, type PlanCode } from '@/lib/billing';
import { getBillingAction, payRenewalAction, removeCardAction, schedulePlanAction, startCheckoutAction, verifyPaymentAction } from './actions';

type State = { plans: Plan[]; current: CurrentPlan; history: BillingInvoice[] | null };
const OUTCOME: Record<string, string> = {
  activated: 'Payment confirmed. Your plan is active.',
  already_applied: 'Payment confirmed. Your plan is active.',
  not_paid: 'Paystack has not confirmed a payment for this checkout. If you paid, it will show here once confirmed.',
  amount_or_currency_mismatch: 'The payment did not match the invoice, so we have not changed your plan. CACU support will contact you.',
  upgrade_no_longer_applies: 'Your billing period changed before this upgrade was paid, so we have not changed your plan. CACU support will refund or apply it.',
  renewal_no_longer_applies: 'Your plan changed before this renewal was paid, so we have not applied it. CACU support will refund or apply it.',
  invoice_void: 'This invoice was replaced before it was paid, so we have not applied it. CACU support will refund or apply it.',
};
const TONE = { good: 'bg-emerald-100 text-emerald-900', warn: 'bg-amber-100 text-amber-900', bad: 'bg-red-100 text-red-900' } as const;
const INVOICE_STATUS = { open: 'Awaiting payment', paid: 'Paid', review: 'Under review', void: 'Void' } as const;

export default function BillingPage() {
  const { business } = useBusiness();
  const manager = ['owner', 'admin'].includes(business?.userRole ?? '');
  const [state, setState] = useState<State | null>(null), [loadError, setLoadError] = useState('');
  const [period, setPeriod] = useState<BillingInterval>('monthly');
  const [busy, setBusy] = useState<PlanCode | 'renewal' | 'card' | null>(null), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  // One request key per plan choice, kept across retries so a lost response never opens a second invoice.
  const keys = useRef(new Map<string, string>());
  const verified = useRef(false);

  const load = useCallback(async () => {
    if (!business) return;
    const result = await getBillingAction(manager);
    if (result.success) { setState(result.data); setLoadError(''); } else setLoadError(result.error);
  }, [business, manager]);

  useEffect(() => {
    if (!business || verified.current) { void load(); return; }
    verified.current = true;
    const reference = returnedReference(new URLSearchParams(window.location.search));
    if (!reference) { void load(); return; }
    // Back from Paystack: the redirect proves nothing until the server has verified the payment.
    window.history.replaceState(null, '', window.location.pathname);
    setMessage('Confirming your payment…');
    void verifyPaymentAction(reference).then(async result => {
      if (result.success) setMessage(OUTCOME[result.data.outcome] ?? 'We could not confirm this payment yet.');
      else { setMessage(''); setError(result.error); }
      await load();
    });
  }, [business, load]);

  async function choose(plan: PlanCode) {
    const choice = `${plan}:${period}`;
    const requestKey = keys.current.get(choice) ?? crypto.randomUUID();
    keys.current.set(choice, requestKey);
    setBusy(plan); setError(''); setMessage('');
    const result = await startCheckoutAction({ request_key: requestKey, plan, interval: period });
    if (result.success) { window.location.assign(result.data.authorization_url); return; }
    setBusy(null); setError(result.error);
  }

  async function payRenewal() {
    setBusy('renewal'); setError(''); setMessage('');
    const result = await payRenewalAction();
    if (result.success) { window.location.assign(result.data.authorization_url); return; }
    setBusy(null); setError(result.error);
  }

  async function removeCard() {
    setBusy('card'); setError(''); setMessage('');
    const result = await removeCardAction();
    if (result.success) { setMessage('Card removed. Renewals will need you to pay from this page.'); await load(); } else setError(result.error);
    setBusy(null);
  }

  // A smaller plan is scheduled, not paid; choosing the current plan again cancels it.
  async function schedule(plan: PlanCode) {
    setBusy(plan); setError(''); setMessage(''); setWarnings([]);
    const result = await schedulePlanAction(plan);
    if (result.success) {
      setMessage(result.data.scheduled_plan ? 'Plan change scheduled.' : 'Scheduled change cancelled. Your plan stays as it is.');
      setWarnings(overLimitNotes(result.data));
      await load();
    } else setError(result.error);
    setBusy(null);
  }

  if (loadError) return <Card><CardHeader><CardTitle>Subscription & billing</CardTitle><CardDescription role="alert">{loadError}</CardDescription></CardHeader></Card>;
  if (!state) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading your plan…</p>;

  const { current, plans, history } = state;
  const status = current.subscribed ? statusOf(current.status) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Subscription & billing</h1>
        <p className="text-sm text-muted-foreground">{VAT_NOTE}</p>
      </div>

      {message && <p role="status" className="rounded-md border bg-muted/40 p-3 text-sm">{message}</p>}
      {warnings.map(line => <p key={line} className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{line}</p>)}
      {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {current.subscribed ? `${current.plan_name} Plan` : 'No plan yet'}
            {status && <Badge className={cn('border-0', TONE[status.tone])}>{status.label}</Badge>}
          </CardTitle>
          <CardDescription>{current.subscribed ? nextStep(current) : 'This workspace has no subscription yet.'}</CardDescription>
        </CardHeader>
        {current.subscribed && manager && (current.renewal || current.card) && (
          <CardContent className="space-y-3">
            {current.renewal && (
              <div className={cn('rounded-md border p-3 text-sm', current.renewal.last_failure && 'border-amber-300 bg-amber-50 text-amber-900')}>
                <p>{renewalLine(current.renewal, current.card)}</p>
                {(!current.card || current.renewal.last_failure) && (
                  <Button className="mt-2" size="sm" disabled={busy !== null} onClick={payRenewal}>
                    {busy === 'renewal' ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening Paystack…</> : `Pay ${naira(current.renewal.total_kobo)} now`}
                  </Button>)}
              </div>)}
            {current.card && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>Saved for renewals: {cardLine(current.card)}</span>
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={removeCard}>{busy === 'card' ? 'Removing…' : 'Remove card'}</Button>
              </div>)}
          </CardContent>)}
        {current.subscribed && usageLines(current).length > 0 && (
          <CardContent>
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              {usageLines(current).map(line => (
                <div key={line.key} className="rounded-md border p-3">
                  <dt className="text-muted-foreground">{line.label}</dt>
                  <dd className={cn('font-semibold', line.full && 'text-amber-700')}>{line.text}{line.full && ' · plan limit reached'}</dd>
                </div>))}
            </dl>
          </CardContent>)}
      </Card>

      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">Plans</h2>
        <div role="group" aria-label="Billing interval" className="inline-flex rounded-md border p-1">
          {(['monthly', 'annual'] as const).map(value => (
            <Button key={value} type="button" size="sm" variant={period === value ? 'default' : 'ghost'} aria-pressed={period === value} onClick={() => setPeriod(value)}>
              {value === 'monthly' ? 'Monthly' : 'Yearly (2 months free)'}
            </Button>))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {plans.map(plan => {
          const amount = price(plan, period);
          const action = planAction(current, plan, period);
          return (
            <Card key={plan.code} className={cn('flex flex-col', plan.code === 'GROW' && 'border-primary')}>
              <CardHeader>
                <CardTitle>{plan.name}</CardTitle>
                <CardDescription>{planLine(plan.code)}</CardDescription>
                <p className="pt-2 text-3xl font-bold">
                  {amount === null ? 'Monthly only' : naira(amount)}
                  {amount !== null && <span className="text-sm font-normal text-muted-foreground"> / {period === 'annual' ? 'year' : 'month'} + VAT</span>}
                </p>
              </CardHeader>
              <CardContent className="flex-1">
                <ul className="space-y-2 text-sm">
                  {highlights(plan.entitlements).map(line => <li key={line} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{line}</li>)}
                </ul>
              </CardContent>
              <CardFooter className="flex-col items-stretch gap-2">
                {manager ? (<>
                  <Button className="w-full" variant={action.kind === 'cancel' || action.kind === 'schedule' ? 'outline' : 'default'}
                    disabled={['current', 'none'].includes(action.kind) || busy !== null}
                    onClick={() => action.kind === 'schedule' ? schedule(plan.code)
                      : action.kind === 'cancel' && current.subscribed ? schedule(current.plan) : choose(plan.code)}>
                    {busy === plan.code ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {['schedule', 'cancel'].includes(action.kind) ? 'Saving…' : 'Opening Paystack…'}</>
                      : action.label}
                  </Button>
                  {action.note && <p className="text-xs text-muted-foreground">{action.note}</p>}
                </>) : <p className="text-xs text-muted-foreground">Only an Owner or Admin can change the plan.</p>}
              </CardFooter>
            </Card>);
        })}
      </div>

      {history && (
        <Card>
          <CardHeader><CardTitle>Invoices and receipts</CardTitle></CardHeader>
          <CardContent>
            {history.length === 0 ? <p className="text-sm text-muted-foreground">No CACU invoices yet.</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Plan</TableHead><TableHead className="text-right">VAT</TableHead>
                  <TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead><TableHead>Receipt</TableHead></TableRow></TableHeader>
                <TableBody>
                  {history.map(row => (
                    <TableRow key={row.invoice}>
                      <TableCell className="font-mono text-xs">{row.invoice}</TableCell>
                      <TableCell>{plans.find(p => p.code === row.plan)?.name ?? row.plan} · {row.kind === 'upgrade' || row.kind === 'renewal' ? row.kind : row.billing_interval === 'annual' ? 'yearly' : 'monthly'}</TableCell>
                      <TableCell className="text-right">{naira(row.vat_kobo)}</TableCell>
                      <TableCell className="text-right">{naira(row.total_kobo)}</TableCell>
                      <TableCell>{INVOICE_STATUS[row.status]}</TableCell>
                      <TableCell className="font-mono text-xs">{row.receipt ?? '—'}</TableCell>
                    </TableRow>))}
                </TableBody>
              </Table>)}
          </CardContent>
        </Card>)}
    </div>
  );
}
