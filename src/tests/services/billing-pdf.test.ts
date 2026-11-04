import { CACU_SELLER, billingDescription, invoiceDocument, receiptDocument, savePdf } from '@/lib/billing-pdf';
import type { BillingInvoice } from '@/lib/billing';

const pdf = { setFont: jest.fn().mockReturnThis(), setFontSize: jest.fn().mockReturnThis(), text: jest.fn().mockReturnThis(), save: jest.fn() };
const autoTable = jest.fn();
jest.mock('jspdf', () => ({ jsPDF: jest.fn(() => pdf) }));
jest.mock('jspdf-autotable', () => ({ __esModule: true, default: (...args: unknown[]) => autoTable(...args) }));

const paid: BillingInvoice = { invoice: 'CACU-INV-000007', plan: 'GROW', billing_interval: 'monthly', kind: 'subscription',
  subtotal_kobo: 600000, vat_rate_bps: 750, vat_kobo: 45000, total_kobo: 645000, status: 'paid', created_at: '2026-11-02T09:55:00Z',
  paid_at: '2026-11-02T10:00:00Z', period_start: null, period_end: null, receipt: 'CACU-RCT-000004', receipt_amount_kobo: 645000, channel: 'card' };

test('the invoice names CACU as seller, the business as buyer, the period and VAT, in NGN', () => {
  expect(CACU_SELLER).toEqual({ name: 'CACU Technologies Limited', address: ['15 College Road, Ipaja', 'Lagos State, Nigeria'] });
  const document = invoiceDocument(paid, 'Ada Provisions');
  expect(document).toMatchObject({ title: 'Invoice', number: 'CACU-INV-000007', fileName: 'CACU-INV-000007.pdf', billedTo: 'Ada Provisions' });
  expect(document.details).toEqual([['Invoice number', 'CACU-INV-000007'], ['Date issued', '2 November 2026'], ['Status', 'Paid'],
    ['Paid on', '2 November 2026'], ['Receipt', 'CACU-RCT-000004']]);
  expect(document.lines).toEqual([['Oga Plan, monthly subscription: 2 November 2026 to 2 December 2026', 'NGN 6,000.00']]);
  expect(document.totals).toEqual([['Subtotal', 'NGN 6,000.00'], ['VAT (7.5%)', 'NGN 450.00'], ['Total', 'NGN 6,450.00']]);
  expect(JSON.stringify(document)).not.toMatch(/TIN/);
});

test('renewals and plan changes describe what they pay for', () => {
  expect(billingDescription({ ...paid, kind: 'renewal', billing_interval: 'annual', period_start: '2026-12-02T10:00:00Z' }))
    .toBe('Oga Plan, yearly renewal: 2 December 2026 to 2 December 2027');
  expect(billingDescription({ ...paid, plan: 'TOP', kind: 'upgrade' })).toBe('Change to the Chairman Plan, monthly, prorated for the current period');
  expect(billingDescription({ ...paid, status: 'open', paid_at: null })).toBe('Oga Plan, monthly subscription');
});

test('a receipt exists only for a verified payment and shows how it was paid', () => {
  expect(receiptDocument({ ...paid, status: 'open', paid_at: null, receipt: null }, 'Ada Provisions')).toBeNull();
  const receipt = receiptDocument(paid, 'Ada Provisions');
  expect(receipt?.details).toEqual([['Receipt number', 'CACU-RCT-000004'], ['Date paid', '2 November 2026'], ['For invoice', 'CACU-INV-000007'], ['Paid by', 'Card']]);
  expect(receipt?.totals.at(-1)).toEqual(['Amount received', 'NGN 6,450.00']);
});

test('saving draws the seller, the document and its tables, then saves under its number', async () => {
  await savePdf(invoiceDocument(paid, 'Ada Provisions'));
  expect(pdf.text).toHaveBeenCalledWith('CACU Technologies Limited', 14, 20);
  expect(pdf.text).toHaveBeenCalledWith(['15 College Road, Ipaja', 'Lagos State, Nigeria'], 14, 27);
  expect(pdf.text).toHaveBeenCalledWith('INVOICE', 196, 20, { align: 'right' });
  expect(autoTable).toHaveBeenCalledTimes(3);
  expect(pdf.save).toHaveBeenCalledWith('CACU-INV-000007.pdf');
});
