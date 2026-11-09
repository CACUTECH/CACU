"use client";
// A pay link (Doc 10 E23): opens without an account and shows one invoice's amount due. The customer pays on
// Paystack's own page, into the business's own Paystack account. Coming back proves nothing: CACU asks Paystack
// before showing "Paid". Never the customer's contact details.
import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { paySummaryAction, startPayAction, verifyPayAction } from '@/app/pay/actions';
import { naira, payAmountError, type PayStatus, type PaySummary } from '@/lib/online-payments';

const REFERENCE = /^CACU-PAY-[0-9a-f]{32}$/;

function PayLink() {
  const { token } = useParams<{ token: string }>();
  const params = useSearchParams();
  const reference = params?.get('reference') ?? params?.get('trxref') ?? '';
  const [summary, setSummary] = React.useState<PaySummary | null | undefined>(undefined);
  const [gone, setGone] = React.useState(''), [error, setError] = React.useState('');
  const [amount, setAmount] = React.useState(''), [email, setEmail] = React.useState('');
  const [busy, setBusy] = React.useState(false), [result, setResult] = React.useState<PayStatus | null>(null);

  React.useEffect(() => {
    let live = true;
    if (!/^[0-9a-f]{64}$/.test(token ?? '')) { setSummary(null); return; }
    void paySummaryAction(token).then(r => {
      if (!live) return;
      if (r.success) { setSummary(r.data); setAmount(r.data.payable); } else { setSummary(null); setGone(r.gone ? '' : r.error); }
    });
    return () => { live = false; };
  }, [token]);

  // Back from Paystack: ask a few times, because Paystack may take a moment to confirm.
  React.useEffect(() => {
    if (!REFERENCE.test(reference) || !token) return;
    let live = true, tries = 0;
    const ask = async () => {
      const r = await verifyPayAction(token, reference);
      if (!live) return;
      if (!r.success) { setError(r.error); return; }
      setResult(r.data);
      if (r.data.summary) { setSummary(r.data.summary); setAmount(r.data.summary.payable); }
      if (r.data.status === 'pending' && ++tries < 4) setTimeout(() => void ask(), 4000);
    };
    void ask();
    return () => { live = false; };
  }, [token, reference]);

  if (summary === undefined) return <main className="mx-auto max-w-sm p-6"><p role="status">Loading invoice…</p></main>;
  if (summary === null) return <main className="mx-auto max-w-sm space-y-2 p-6"><h1 className="text-xl font-bold">Pay link not available</h1>
    <p className="text-muted-foreground">{gone || 'This link does not work. It may have been typed wrongly, or the business has withdrawn it. Ask the business for a new one.'}</p></main>;

  const pay = async (event: React.FormEvent) => {
    event.preventDefault();
    const problem = payAmountError(amount, summary);
    if (problem) { setError(problem); return; }
    if (summary.needs_email && !/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(email.trim())) { setError('Enter your email address for the Paystack receipt.'); return; }
    setBusy(true); setError('');
    const r = await startPayAction(token, amount.trim(), summary.needs_email ? email.trim() : null);
    if (r.success) { window.location.assign(r.data.authorization_url); return; }
    setBusy(false); setError(r.error);
  };
  const paid = Number(summary.payable) <= 0;

  return <main className="mx-auto max-w-sm space-y-4 p-4">
    <article aria-label="Invoice" className="space-y-3 rounded-lg border bg-white p-4 text-sm text-black">
      <header className="text-center">
        <h1 className="text-lg font-bold">{summary.business.name}</h1>
        {summary.business.address && <p>{summary.business.address}</p>}
        {summary.business.phone && <p>{summary.business.phone}</p>}
        <p className="mt-2">Invoice {summary.invoice_number}{summary.customer_name ? ` for ${summary.customer_name}` : ''}</p>
        {summary.due_date && <p>Due {summary.due_date}</p>}
      </header>
      <p className="flex justify-between"><span>Invoice total</span><span>{naira(summary.total)}</span></p>
      <p className="flex justify-between text-base font-bold"><span>Still owed</span><span>{naira(summary.outstanding)}</span></p>
      {Number(summary.outstanding) > Number(summary.payable) && <p className="text-xs">{naira(Number(summary.outstanding) - Number(summary.payable))} is already on its way by transfer.</p>}
    </article>
    {result?.status === 'posted' && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-800">Payment of {naira(result.paid)} received. Thank you. It is now recorded against this invoice.</p>}
    {result?.status === 'pending' && <p role="status" className="rounded-lg bg-amber-50 p-3 text-amber-900">Paystack has not confirmed this payment yet. If money left your account, it will show here once Paystack confirms. You do not need to pay again.</p>}
    {result?.status === 'failed' && <p role="status" className="rounded-lg bg-muted p-3">That payment was not completed. You can try again below.</p>}
    {result?.status === 'needs_review' && <p role="status" className="rounded-lg bg-amber-50 p-3 text-amber-900">Paystack confirmed a payment we need to check by hand. {summary.business.name} will contact you; do not pay again.</p>}
    {paid ? <p className="text-center font-semibold">Nothing is left to pay on this invoice.</p>
      : result?.status !== 'pending' && result?.status !== 'needs_review' && <form onSubmit={e => void pay(e)} className="space-y-3 rounded-lg border p-4">
        <label className="block text-sm font-medium">Amount to pay (NGN)
          <input className="mt-1 w-full rounded border px-3 py-2" inputMode="decimal" value={amount} disabled={busy} onChange={e => setAmount(e.target.value)} /></label>
        <p className="text-xs text-muted-foreground">You can pay part now and the rest later.</p>
        {summary.needs_email && <label className="block text-sm font-medium">Your email (for the Paystack receipt)
          <input className="mt-1 w-full rounded border px-3 py-2" type="email" autoComplete="email" value={email} disabled={busy} onChange={e => setEmail(e.target.value)} /></label>}
        <button type="submit" disabled={busy} className="w-full rounded bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-60">{busy ? 'Opening Paystack…' : 'Pay with Paystack'}</button>
        <p className="text-xs text-muted-foreground">Card, bank transfer or USSD on Paystack&apos;s secure page. The money goes to {summary.business.name}.</p>
      </form>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <p className="text-center text-xs text-muted-foreground">Invoice sent by {summary.business.name} using CACU.</p>
  </main>;
}

export default function PayPage() {
  return <React.Suspense fallback={<main className="mx-auto max-w-sm p-6"><p role="status">Loading invoice…</p></main>}><PayLink /></React.Suspense>;
}
