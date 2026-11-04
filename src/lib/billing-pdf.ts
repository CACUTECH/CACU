// CACU's own invoices and receipts as PDFs (Doc 14 SUB-14), drawn in the browser from the billing history the database
// returns. The content is built as plain data first so it can be checked without drawing anything.
import { PLAN_NAME, type BillingInvoice } from '@/lib/billing';

// Owner-approved seller details (4 November 2026). No TIN is printed.
export const CACU_SELLER = { name: 'CACU Technologies Limited', address: ['15 College Road, Ipaja', 'Lagos State, Nigeria'] };

export type BillingDocument = {
  title: 'Invoice' | 'Receipt'; number: string; fileName: string; billedTo: string;
  details: [string, string][]; lines: [string, string][]; totals: [string, string][]; footer: string;
};

// The PDF's built-in fonts have no naira sign, so amounts print as NGN.
const ngn = (kobo: number) => `NGN ${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' });
const periodEnd = (iso: string, interval: BillingInvoice['billing_interval']) => {
  const end = new Date(iso);
  if (interval === 'annual') end.setUTCFullYear(end.getUTCFullYear() + 1); else end.setUTCMonth(end.getUTCMonth() + 1);
  return end.toISOString();
};
const STATUS: Record<BillingInvoice['status'], string> = { open: 'Awaiting payment', paid: 'Paid', review: 'Under review', void: 'Void' };
const CHANNEL: Record<string, string> = { card: 'Card', bank: 'Bank', bank_transfer: 'Bank transfer', ussd: 'USSD', mobile_money: 'Mobile money', qr: 'QR' };

/** One line saying what was bought and for which period. */
export function billingDescription(row: BillingInvoice) {
  const plan = `${PLAN_NAME[row.plan]} Plan`, interval = row.billing_interval === 'annual' ? 'yearly' : 'monthly';
  if (row.kind === 'renewal' && row.period_start) {
    return `${plan}, ${interval} renewal: ${day(row.period_start)} to ${day(periodEnd(row.period_start, row.billing_interval))}`;
  }
  if (row.kind === 'upgrade') return `Change to the ${plan}, ${interval}, prorated for the current period`;
  return row.paid_at ? `${plan}, ${interval} subscription: ${day(row.paid_at)} to ${day(periodEnd(row.paid_at, row.billing_interval))}`
    : `${plan}, ${interval} subscription`;
}

const vatLabel = (row: BillingInvoice) => `VAT (${((row.vat_rate_bps ?? 750) / 100).toLocaleString('en-NG')}%)`;

export function invoiceDocument(row: BillingInvoice, billedTo: string): BillingDocument {
  const details: [string, string][] = [['Invoice number', row.invoice], ['Date issued', day(row.created_at)], ['Status', STATUS[row.status]]];
  if (row.paid_at) details.push(['Paid on', day(row.paid_at)]);
  if (row.receipt) details.push(['Receipt', row.receipt]);
  return {
    title: 'Invoice', number: row.invoice, fileName: `${row.invoice}.pdf`, billedTo, details,
    lines: [[billingDescription(row), ngn(row.subtotal_kobo)]],
    totals: [['Subtotal', ngn(row.subtotal_kobo)], [vatLabel(row), ngn(row.vat_kobo)], ['Total', ngn(row.total_kobo)]],
    footer: 'Plan prices exclude VAT; VAT is added at the rate shown. Thank you for using CACU.',
  };
}

/** Null until the invoice is paid: a receipt exists only for verified payments. */
export function receiptDocument(row: BillingInvoice, billedTo: string): BillingDocument | null {
  if (row.status !== 'paid' || !row.receipt || !row.paid_at) return null;
  const details: [string, string][] = [['Receipt number', row.receipt], ['Date paid', day(row.paid_at)], ['For invoice', row.invoice]];
  if (row.channel) details.push(['Paid by', CHANNEL[row.channel] ?? row.channel]);
  return {
    title: 'Receipt', number: row.receipt, fileName: `${row.receipt}.pdf`, billedTo, details,
    lines: [[billingDescription(row), ngn(row.subtotal_kobo)]],
    totals: [['Subtotal', ngn(row.subtotal_kobo)], [vatLabel(row), ngn(row.vat_kobo)], ['Amount received', ngn(row.receipt_amount_kobo ?? row.total_kobo)]],
    footer: 'Payment received with thanks.',
  };
}

/** Draws the document and saves it as a PDF. */
export async function savePdf(document: BillingDocument) {
  const { jsPDF } = await import('jspdf'); const { default: autoTable } = await import('jspdf-autotable');
  const pdf = new jsPDF();
  pdf.setFont('helvetica', 'bold').setFontSize(16).text(CACU_SELLER.name, 14, 20);
  pdf.setFont('helvetica', 'normal').setFontSize(10).text(CACU_SELLER.address, 14, 27);
  pdf.setFont('helvetica', 'bold').setFontSize(20).text(document.title.toUpperCase(), 196, 20, { align: 'right' });
  pdf.setFont('helvetica', 'normal').setFontSize(10).text(document.number, 196, 27, { align: 'right' });
  pdf.setFont('helvetica', 'bold').text(document.title === 'Invoice' ? 'Billed to' : 'Received from', 14, 45);
  pdf.setFont('helvetica', 'normal').text(document.billedTo, 14, 51);
  autoTable(pdf, { startY: 58, theme: 'plain', body: document.details, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40 } } });
  autoTable(pdf, { head: [['Description', 'Amount']], body: document.lines, columnStyles: { 1: { halign: 'right', cellWidth: 45 } } });
  autoTable(pdf, { theme: 'plain', body: document.totals, margin: { left: 106 },
    columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right' } },
    didParseCell: cell => { if (cell.row.index === document.totals.length - 1) cell.cell.styles.fontStyle = 'bold'; } });
  pdf.setFontSize(9).text(document.footer, 14, 285);
  pdf.save(document.fileName);
}
