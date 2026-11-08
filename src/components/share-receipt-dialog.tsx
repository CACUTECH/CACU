"use client";
// Sends a sale's receipt to the customer (Doc 10 E20): by email, by text (from the plan's monthly allowance) and as a link
// the customer opens without logging in. The request keeps its key across an uncertain retry, so nothing is sent twice.
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useKeyedRequest } from '@/hooks/use-keyed-request';
import { receiptLink, rpc, sharedText, type Shared } from '@/lib/customer-messages';

export function ShareReceiptDialog({ businessId, saleId, open, onClose }: { businessId: string; saleId: string; open: boolean; onClose: () => void }) {
  const [email, setEmail] = React.useState(''), [phone, setPhone] = React.useState('');
  const [shared, setShared] = React.useState<Shared | null>(null), [note, setNote] = React.useState('');
  const { attempt, run, reset } = useKeyedRequest();
  const locked = attempt.busy || attempt.uncertain;
  const send = async () => {
    const done = await run(key => rpc<Shared>('share_receipt', { p_business_id: businessId, p_sale_id: saleId, p_request_key: key,
      p_email: email.trim() || null, p_phone: phone.trim() || null }));
    if (done) { setShared(done); setNote(sharedText(done)); }
  };
  const revoke = async () => {
    const done = await rpc<boolean>('revoke_receipt_link', { p_business_id: businessId, p_sale_id: saleId });
    if (done.success) { setShared(null); setNote('The link no longer works. Sending the receipt again makes a new one.'); }
    else setNote(done.error);
  };
  const copy = async (link: string) => {
    try { await navigator.clipboard.writeText(link); setNote('Link copied.'); } catch { setNote('Copy the link above.'); }
  };
  const link = shared ? receiptLink(shared.token) : '';
  return <Dialog open={open} onOpenChange={o => { if (!o && !attempt.busy) { reset(); setShared(null); setNote(''); onClose(); } }}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>Send receipt to customer</DialogTitle>
        <DialogDescription>Enter an email, a phone number, or both. Leave both empty to get a link you can share yourself.</DialogDescription></DialogHeader>
      <div className="grid gap-3 text-sm">
        <label className="space-y-1"><span>Customer&apos;s email (optional)</span>
          <Input type="email" autoComplete="off" maxLength={254} value={email} disabled={locked} onChange={e => setEmail(e.target.value)} /></label>
        <label className="space-y-1"><span>Customer&apos;s phone (optional)</span>
          <Input inputMode="tel" autoComplete="off" maxLength={20} placeholder="0803 123 4567" value={phone} disabled={locked} onChange={e => setPhone(e.target.value)} /></label>
        {shared && <div className="space-y-2 rounded-md border p-3">
          <p className="break-all font-mono text-xs">{link}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void copy(link)}>Copy link</Button>
            <Button size="sm" variant="outline" asChild><a href={`https://wa.me/?text=${encodeURIComponent(`Your receipt: ${link}`)}`} target="_blank" rel="noopener noreferrer">Share on WhatsApp</a></Button>
            <Button size="sm" variant="ghost" onClick={() => void revoke()}>Revoke link</Button>
          </div>
          <p className="text-muted-foreground">Texts this month: {shared.texts.used} of {shared.texts.limit}.</p>
        </div>}
        {note && <p role="status" className="text-emerald-700">{note}</p>}
        {attempt.error && <p role="alert" className="text-destructive">{attempt.error}</p>}
      </div>
      <DialogFooter><Button className="w-full" disabled={attempt.busy} onClick={() => void send()}>{attempt.busy ? 'Sending…' : email.trim() || phone.trim() ? 'Send receipt' : 'Get link'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
