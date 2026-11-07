'use server';
// Purchasing part 2 (Doc 10 purchase-to-payment, PR-18): goods received post to the books, so they go through the accounting API.
import { revalidatePath } from 'next/cache';
import { AccountingRequestError, accountingRequest, usesPythonAccounting } from '@/lib/accounting-client';
import type { GoodsReceipt, ReceiptSummary } from '@/lib/purchasing';

type Result<T> = { success: true; data: T } | { success: false; error: string; uncertain: boolean };
function failed(error: unknown, fallback = 'The change was not confirmed. Refresh before trying again.'): { success: false; error: string; uncertain: boolean } {
  const known = error instanceof AccountingRequestError && error.status < 500;
  return { success: false, error: known ? error.message : fallback, uncertain: !known };
}

/** Receipts for an order, or the latest receipts; null before the books are turned on. */
export async function listReceiptsAction(orderId?: string): Promise<Result<ReceiptSummary[] | null>> {
  try {
    if (!(await usesPythonAccounting())) return { success: true, data: null };
    return { success: true, data: await accountingRequest<ReceiptSummary[]>(`goods-receipts${orderId ? `?${new URLSearchParams({ order_id: orderId })}` : ''}`) };
  } catch (error) { return failed(error, 'Goods receipts are unavailable. Refresh to try again.'); }
}

export async function getReceiptAction(id: string): Promise<Result<GoodsReceipt>> {
  try { return { success: true, data: await accountingRequest<GoodsReceipt>(`goods-receipts/${encodeURIComponent(id)}`) }; }
  catch (error) { return failed(error, 'The receipt is unavailable. Refresh to try again.'); }
}

export type ReceiveInput = {
  requestKey: string; orderId?: string; supplierId?: string; note: string;
  lines: { itemId: string; quantity: number; unitCost: string }[];
};

/** Stock goes up at the actual cost and the weighted average moves; Dr Inventory, Cr Goods received not invoiced. */
export async function receiveGoodsAction(input: ReceiveInput): Promise<Result<GoodsReceipt>> {
  try {
    const data = await accountingRequest<GoodsReceipt>('goods-receipts', { method: 'POST', body: {
      request_key: input.requestKey, order_id: input.orderId || null, supplier_id: input.supplierId || null, note: input.note,
      lines: input.lines.map(l => ({ item_id: l.itemId, quantity: l.quantity, unit_cost: l.unitCost })) } });
    revalidatePath('/purchases'); revalidatePath('/catalog');
    return { success: true, data };
  } catch (error) { return failed(error); }
}

/** Goods sent back to the supplier, at the cost they were received at. */
export async function returnGoodsAction(receiptId: string, input: { requestKey: string; reason: string; lines: { itemId: string; quantity: number }[] }): Promise<Result<GoodsReceipt>> {
  try {
    const data = await accountingRequest<GoodsReceipt>(`goods-receipts/${encodeURIComponent(receiptId)}/returns`, { method: 'POST', body: {
      request_key: input.requestKey, reason: input.reason, lines: input.lines.map(l => ({ item_id: l.itemId, quantity: l.quantity })) } });
    revalidatePath('/purchases'); revalidatePath('/catalog');
    return { success: true, data };
  } catch (error) { return failed(error); }
}

export type BilledGoods = { id: string; bill_number: string; total: string; received_value: string; difference_to_stock: string; difference_to_cost_of_sales: string };

/** PR-18: the supplier's bill for received goods; any difference from the received cost adjusts stock cost (IAS 2). */
export async function billReceivedAction(input: { requestKey: string; supplierId: string; billNumber: string; entryDate: string; dueDate?: string; notes: string;
  lines: { receiptId: string; itemId: string; quantity: number; amount: string }[] }): Promise<Result<BilledGoods>> {
  try {
    const data = await accountingRequest<BilledGoods>('goods-receipts/bills', { method: 'POST', body: {
      request_key: input.requestKey, supplier_id: input.supplierId, bill_number: input.billNumber, entry_date: input.entryDate,
      due_date: input.dueDate || null, notes: input.notes,
      lines: input.lines.map(l => ({ receipt_id: l.receiptId, item_id: l.itemId, quantity: l.quantity, amount: l.amount })) } });
    revalidatePath('/purchases'); revalidatePath('/accounting/bills'); revalidatePath('/catalog');
    return { success: true, data };
  } catch (error) { return failed(error); }
}

