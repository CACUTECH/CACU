"use client";
// Settings › Online payments (Doc 10 E23): an Owner or Admin connects the business's own Paystack account. Customers
// then pay invoices from a pay link; verified payments post to Card and online payments clearing (PR-14) and each
// Paystack payout is matched to the bank, less the fee (PR-15).
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { checkPaystackAction, connectPaystackAction, disconnectPaystackAction, onlinePaymentsAction } from '@/app/settings/online-payments/actions';
import { naira, PAYMENT_STATUS, type OnlineOverview } from '@/lib/online-payments';

export default function OnlinePaymentsPage() {
  const [overview, setOverview] = React.useState<OnlineOverview | null>(null);
  const [error, setError] = React.useState(''), [message, setMessage] = React.useState(''), [busy, setBusy] = React.useState(false);
  const [secret, setSecret] = React.useState(''), [bank, setBank] = React.useState('');
  const [requestKey, setRequestKey] = React.useState(() => crypto.randomUUID());

  const load = React.useCallback(async () => {
    const r = await onlinePaymentsAction();
    if (r.success) { setOverview(r.data); setBank(b => b || r.data.settings.settlement_bank_account_id || r.data.settings.banks[0]?.id || ''); } else setError(r.error);
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const heading = <div><h1 className="font-headline text-3xl font-bold">Online payments</h1>
    <p className="text-muted-foreground">Let customers pay invoices by card, transfer or USSD through your own Paystack account.</p></div>;
  if (error && !overview) return <div className="space-y-4">{heading}<p role="alert" className="text-destructive">{error}</p></div>;
  if (!overview) return <div className="space-y-4">{heading}<p role="status">Loading…</p></div>;
  const s = overview.settings;

  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^sk_(test|live)_[A-Za-z0-9]{20,100}$/.test(secret.trim())) { setError('Paste your Paystack secret key. It starts with sk_live_ (or sk_test_ to try it out).'); return; }
    if (!bank) { setError('Choose the bank account Paystack pays your money into.'); return; }
    setBusy(true); setError(''); setMessage('');
    const r = await connectPaystackAction({ request_key: requestKey, secret_key: secret.trim(), settlement_bank_account_id: bank });
    setBusy(false);
    if (r.success) { setSecret(''); setRequestKey(crypto.randomUUID()); setMessage('Paystack connected. Add the webhook address below in Paystack.'); await load(); }
    else setError(r.error);
  };
  const disconnect = async () => {
    if (!window.confirm('Disconnect Paystack? Pay links stop working until you connect again. Payments already received stay in your books.')) return;
    setBusy(true); setError('');
    const r = await disconnectPaystackAction();
    setBusy(false);
    if (r.success) { setMessage('Paystack disconnected. The saved key was deleted.'); await load(); } else setError(r.error);
  };
  const check = async () => {
    setBusy(true); setError(''); setMessage('');
    const r = await checkPaystackAction();
    setBusy(false);
    if (r.success) {
      setMessage(`Checked with Paystack: ${r.data.posted} payment${r.data.posted === 1 ? '' : 's'} confirmed, ${r.data.payouts} payout${r.data.payouts === 1 ? '' : 's'} matched to the bank${r.data.payouts_for_review ? `, ${r.data.payouts_for_review} payout${r.data.payouts_for_review === 1 ? '' : 's'} to review` : ''}.`);
      await load();
    } else setError(r.error);
  };

  return <div className="max-w-3xl space-y-6">{heading}
    <section className="space-y-3 rounded-xl border p-4" aria-label="Paystack">
      <h2 className="font-semibold">Paystack</h2>
      {s.connected ? <>
        <p>Connected{s.mode === 'test' ? ' in test mode (no real money moves)' : ''}. Key {s.key_hint}. Payouts go to {s.banks.find(b => b.id === s.settlement_bank_account_id)?.name ?? 'your chosen bank account'}.</p>
        {s.webhook_url && <div className="space-y-1 text-sm">
          <p className="font-medium">Webhook address</p>
          <p>In Paystack, open Settings, then API Keys &amp; Webhooks, and paste this as the webhook URL, so payments show here at once:</p>
          <code className="block break-all rounded bg-muted p-2" aria-label="Webhook address">{s.webhook_url}</code>
          <Button type="button" variant="outline" size="sm" onClick={() => void navigator.clipboard?.writeText(s.webhook_url ?? '').then(() => setMessage('Webhook address copied.'))}>Copy address</Button>
          <p className="text-muted-foreground">Without it, CACU still checks Paystack every 30 minutes and when the customer comes back from paying.</p>
        </div>}
        {s.can_manage && <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} onClick={() => void check()}>Check Paystack now</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void disconnect()}>Disconnect</Button>
        </div>}
      </> : <p>Not connected. Customers can still pay by cash or transfer.</p>}
      {s.can_manage ? <form onSubmit={e => void connect(e)} className="space-y-3 border-t pt-3">
        <h3 className="font-medium">{s.connected ? 'Change key or payout bank' : 'Connect your Paystack account'}</h3>
        <p className="text-sm text-muted-foreground">Find your secret key in Paystack under Settings, then API Keys &amp; Webhooks. CACU checks it with Paystack, stores it encrypted, and never shows it again. Money goes straight to your Paystack account; CACU never holds it.</p>
        <label className="block text-sm font-medium">Paystack secret key
          <input className="mt-1 w-full rounded border px-3 py-2 font-mono" type="password" autoComplete="off" spellCheck={false} value={secret} disabled={busy} onChange={e => setSecret(e.target.value)} /></label>
        <label className="block text-sm font-medium">Bank account Paystack pays into
          <select className="mt-1 w-full rounded border px-3 py-2" value={bank} disabled={busy} onChange={e => setBank(e.target.value)}>
            <option value="">Choose a bank account</option>
            {s.banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select></label>
        {s.banks.length === 0 && <p className="text-sm text-amber-700">Add your bank account in Settings, Banks first.</p>}
        <Button type="submit" disabled={busy}>{busy ? 'Checking with Paystack…' : s.connected ? 'Save' : 'Connect Paystack'}</Button>
      </form> : <p className="text-sm">Only an Owner or Admin can connect Paystack.</p>}
      {message && <p role="status" className="text-emerald-700">{message}</p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </section>

    <section className="space-y-2" aria-label="Payments">
      <h2 className="font-semibold">Payments</h2>
      <p className="text-sm text-muted-foreground">Waiting for Paystack to pay out: {naira(overview.awaiting_payout)}</p>
      {overview.payments.length === 0 ? <p className="text-sm text-muted-foreground">No online payments yet. Share a pay link from an invoice&apos;s menu.</p>
        : <table className="w-full text-sm"><thead><tr className="text-left"><th>Invoice</th><th>Customer</th><th>Amount</th><th>Status</th></tr></thead><tbody>
          {overview.payments.map(p => <tr key={p.reference} className="border-t align-top">
            <td>{p.invoice_number}</td><td>{p.customer ?? ''}</td>
            <td>{naira(p.paid ?? p.amount)}{p.fee && <span className="block text-xs text-muted-foreground">Fee {naira(p.fee)}</span>}</td>
            <td>{PAYMENT_STATUS[p.status]}{p.status === 'posted' && <span className="block text-xs text-muted-foreground">{p.settled ? 'Paid out to the bank' : 'Not paid out yet'}</span>}
              {p.review_reason && <span className="block text-xs text-amber-700">{p.review_reason}</span>}</td>
          </tr>)}</tbody></table>}
    </section>

    <section className="space-y-2" aria-label="Payouts">
      <h2 className="font-semibold">Paystack payouts</h2>
      {overview.payouts.length === 0 ? <p className="text-sm text-muted-foreground">No payouts matched yet.</p>
        : <table className="w-full text-sm"><thead><tr className="text-left"><th>Date</th><th>Payments</th><th>Fees</th><th>Into the bank</th><th>Status</th></tr></thead><tbody>
          {overview.payouts.map(p => <tr key={p.id} className="border-t align-top">
            <td>{p.settled_on}</td><td>{naira(p.gross)}</td><td>{naira(p.fee)}</td><td>{naira(p.net)}</td>
            <td>{p.status === 'posted' ? 'Matched' : 'Needs review'}{p.note && <span className="block text-xs text-amber-700">{p.note}</span>}</td>
          </tr>)}</tbody></table>}
    </section>
  </div>;
}
