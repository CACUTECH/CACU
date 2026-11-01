import type { BillInput, SupplierBill, SupplierPaymentInput } from '../../src/lib/corrections';

// Browser test double for src/app/accounting/bills/actions.ts.
const bills: SupplierBill[] = [{ id: 'open', supplier_id: 's1', supplier_name: 'Mills Ltd', bill_number: 'Opening balance', date: '2026-10-30', due_date: null,
  total: '150000.50', outstanding: '150000.50', status: 'unpaid', opening: true }];
const payments: { billId: string; input: SupplierPaymentInput }[] = [];
let failNextPayment = true;

export async function getBillsAction() {
  return { success: true as const, data: { native: true, bills: bills.map(b => ({ ...b })), accounts: [{ id: 'e1', code: '6100', name: 'Rent' }],
    banks: [{ id: 'b1', name: 'Bank account' }], suppliers: [{ id: 's1', name: 'Mills Ltd' }, { id: 's2', name: 'Kemi Properties' }] } };
}

export async function recordBillAction(input: BillInput) {
  const total = input.lines.reduce((sum, l) => sum + Number(l.amount), 0).toFixed(2);
  bills.unshift({ id: input.request_key, supplier_id: input.supplier_id, supplier_name: input.supplier_id === 's2' ? 'Kemi Properties' : 'Mills Ltd',
    bill_number: input.bill_number, date: input.entry_date, due_date: input.due_date ?? null, total, outstanding: total, status: 'unpaid', opening: false });
  return { success: true as const, data: { id: input.request_key } };
}

export async function paySupplierBillAction(billId: string, input: SupplierPaymentInput) {
  payments.push({ billId, input }); (window as unknown as { billPayments: typeof payments }).billPayments = payments;
  if (failNextPayment) { failNextPayment = false; return { success: false as const, error: 'Accounting request failed (503)', uncertain: true }; }
  const bill = bills.find(b => b.id === billId)!;
  bill.outstanding = (Number(bill.outstanding) - Number(input.amount)).toFixed(2);
  bill.status = Number(bill.outstanding) === 0 ? 'paid' : 'part_paid';
  return { success: true as const, data: { id: input.request_key } };
}
