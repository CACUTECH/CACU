"use client";
// Share pay link (Doc 10 E23): a link the customer opens to pay the invoice through the business's own Paystack
// account. One live link per invoice; withdrawing it stops it working.
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { revokePaymentLinkAction, sharePaymentLinkAction } from '@/app/invoices/payment-link-actions';
import { naira } from '@/lib/online-payments';

type Props = { invoice: { id: string; invoice_number: string } | null; onClose: () => void };

export function PayLinkDialog({ invoice, onClose }: Props) {
  const [link, setLink] = React.useState<{ url: string; outstanding: string } | null>(null);
  const [error, setError] = React.useState(''), [message, setMessage] = React.useState(''), [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!invoice) return;
    let live = true;
    setLink(null); setError(''); setMessage('');
    void sharePaymentLinkAction(invoice.id, crypto.randomUUID()).then(r => {
      if (!live) return;
      if (r.success) setLink({ url: r.data.url, outstanding: r.data.outstanding }); else setError(r.error);
    });
    return () => { live = false; };
  }, [invoice]);

  const text = invoice && link ? `Please pay invoice ${invoice.invoice_number} (${naira(link.outstanding)}) here: ${link.url}` : '';
  const withdraw = async () => {
    if (!invoice) return;
    setBusy(true);
    const r = await revokePaymentLinkAction(invoice.id);
    setBusy(false);
    if (r.success) { setLink(null); setMessage('The link was withdrawn. It no longer works.'); } else setError(r.error);
  };

  return <Dialog open={!!invoice} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>Pay link</DialogTitle>
        <DialogDescription>{invoice?.invoice_number}: the customer pays by card, transfer or USSD on Paystack, into your Paystack account.</DialogDescription></DialogHeader>
      {!link && !error && !message && <p role="status">Making the link…</p>}
      {link && <div className="space-y-3">
        <p>Still owed: {naira(link.outstanding)}. The customer can pay all of it or part.</p>
        <code aria-label="Link for the customer" className="block break-all rounded bg-muted p-2 text-sm">{link.url}</code>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void navigator.clipboard?.writeText(link.url).then(() => setMessage('Link copied.'))}>Copy link</Button>
          <Button type="button" variant="outline" asChild><a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">Share on WhatsApp</a></Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void withdraw()}>Withdraw link</Button>
        </div>
        <p className="text-xs text-muted-foreground">Payments show on the invoice once Paystack confirms them.</p>
      </div>}
      {message && <p role="status" className="text-emerald-700">{message}</p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </DialogContent>
  </Dialog>;
}
