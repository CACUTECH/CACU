import * as React from 'react';
import { InvoicePaymentDialog } from '../../src/components/invoice-payment-dialog';
export function ReceiptDemo() {
  const [open, setOpen] = React.useState(true); const [saved, setSaved] = React.useState(false);
  const invoice = React.useMemo(() => ({ id: 'invoice', invoice_number: 'INV-TEST', total: 100, outstanding: '60.00' }), []);
  return <><p>{saved ? 'Receipt saved' : 'Unpaid invoice'}</p><button onClick={() => setOpen(true)}>Open receipt</button>
    <InvoicePaymentDialog invoice={open ? invoice : null} onClose={() => setOpen(false)} onSaved={() => setSaved(true)} /></>;
}
