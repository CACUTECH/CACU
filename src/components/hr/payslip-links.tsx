"use client";
// Payslip links for an approved payroll run (E21 R4): an Owner or Admin shares each employee's payslip as a link that
// opens without an account, sees whether it has been opened, and can withdraw it. A link is shown once, when made.
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { sharePayslipAction, withdrawPayslipLinkAction } from '@/app/hr/actions';
import { LINK_DAYS, payslipPath, whatsappHref, type PayslipLinkStatus } from '@/lib/payslips';

type Slip = { id: string; employee_name: string };
const day = (iso: string) => new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });

export function PayslipLinks({ period, payslips, links }: { period: string; payslips: Slip[]; links: PayslipLinkStatus[] }) {
  const [days, setDays] = React.useState<number>(30);
  const [status, setStatus] = React.useState(() => new Map(links.map(l => [l.payslip_id, l])));
  const [made, setMade] = React.useState<{ id: string; url: string } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);

  React.useEffect(() => { setStatus(new Map(links.map(l => [l.payslip_id, l]))); }, [links]);

  const share = async (slip: Slip) => {
    setBusy(slip.id); setMessage(null);
    try {
      const r = await sharePayslipAction(slip.id, days);
      if (!r.success) { setMessage({ ok: false, text: r.error }); return; }
      setMade({ id: slip.id, url: `${window.location.origin}${payslipPath(r.data.token)}` });
      setStatus(s => new Map(s).set(slip.id, { payslip_id: slip.id, shared_at: new Date().toISOString(), expires_at: r.data.expires_at, expired: false, open_count: 0, last_opened_at: null }));
    } finally { setBusy(null); }
  };
  const withdraw = async (slip: Slip) => {
    setBusy(slip.id); setMessage(null);
    try {
      const r = await withdrawPayslipLinkAction(slip.id);
      if (!r.success) { setMessage({ ok: false, text: r.error }); return; }
      setStatus(s => { const next = new Map(s); next.delete(slip.id); return next; });
      if (made?.id === slip.id) setMade(null);
      setMessage({ ok: true, text: `${slip.employee_name}'s link no longer works.` });
    } finally { setBusy(null); }
  };
  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); setMessage({ ok: true, text: 'Link copied.' }); }
    catch { setMessage({ ok: false, text: 'Copy the link from the box instead.' }); }
  };

  return <Card aria-label="Payslip links"><CardHeader><CardTitle>Payslips for staff</CardTitle></CardHeader>
    <CardContent className="space-y-3 text-sm">
      <p className="text-muted-foreground">Send each employee their payslip as a private link. It shows their pay and deductions, with their tax ID and pension PIN
        partly hidden. Anyone with the link can open it until it expires, so send it only to the employee. Sharing again replaces the old link.</p>
      <div className="flex items-center gap-2">
        <label htmlFor="link-days">Links work for</label>
        <select id="link-days" className="h-9 rounded-md border bg-background px-2" value={days} onChange={e => setDays(Number(e.target.value))}>
          {LINK_DAYS.map(d => <option key={d} value={d}>{d} days</option>)}
        </select>
      </div>
      {message && <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'text-muted-foreground' : 'text-destructive'}>{message.text}</p>}
      <ul className="divide-y rounded-md border">{payslips.map(slip => {
        const link = status.get(slip.id);
        const fresh = made?.id === slip.id ? made.url : null;
        return <li key={slip.id} className="space-y-2 p-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span><span className="font-medium">{slip.employee_name}</span>
              <span className="block text-xs text-muted-foreground">{!link ? 'Not shared'
                : link.expired ? `Link expired ${day(link.expires_at)}`
                : `Shared ${day(link.shared_at)} · works until ${day(link.expires_at)} · ${link.open_count ? `opened ${link.open_count} time${link.open_count === 1 ? '' : 's'}` : 'not opened yet'}`}</span></span>
            <span className="flex gap-2">
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void share(slip)}>{link ? 'New link' : 'Share link'}</Button>
              {link && !link.expired && <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void withdraw(slip)}>Withdraw</Button>}
            </span>
          </div>
          {fresh && <div className="space-y-2 rounded-md bg-muted p-2">
            <label htmlFor={`url-${slip.id}`} className="block text-xs">Link for {slip.employee_name}. It is shown only now: copy it or send it.</label>
            <input id={`url-${slip.id}`} readOnly value={fresh} className="h-9 w-full rounded-md border bg-background px-2 font-mono text-xs" onFocus={e => e.currentTarget.select()} />
            <span className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void copy(fresh)}>Copy link</Button>
              <Button size="sm" variant="outline" asChild><a href={whatsappHref(slip.employee_name, period, fresh)} target="_blank" rel="noopener noreferrer">Send on WhatsApp</a></Button>
            </span>
          </div>}
        </li>;
      })}</ul>
    </CardContent></Card>;
}
