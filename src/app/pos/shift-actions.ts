'use server';
import { revalidatePath } from 'next/cache';
import { AccountingRequestError, accountingRequest, usesPythonAccounting } from '@/lib/accounting-client';
import type { Shift, ShiftStatus } from '@/lib/shifts';

type Result<T> = { success: true; data: T } | { success: false; error: string; uncertain: boolean };
function failed(error: unknown, fallback = 'The change was not confirmed. Refresh before trying again.'): { success: false; error: string; uncertain: boolean } {
  const known = error instanceof AccountingRequestError && error.status < 500;
  return { success: false, error: known ? error.message : fallback, uncertain: !known };
}

/** The person's open shift, whether shifts are on their plan, and the owner's rule; null before the books are turned on. */
export async function getShiftAction(): Promise<Result<ShiftStatus | null>> {
  try {
    if (!(await usesPythonAccounting())) return { success: true, data: null };
    return { success: true, data: await accountingRequest<ShiftStatus>('shifts/current') };
  } catch (error) { return failed(error, 'Your shift is unavailable. Refresh to try again.'); }
}

/** Shifts opened or closed on a day, and every shift still open; managers see everyone's. */
export async function listShiftsAction(day?: string, status?: 'open' | 'closed'): Promise<Result<Shift[] | null>> {
  try {
    if (!(await usesPythonAccounting())) return { success: true, data: null };
    const query = new URLSearchParams();
    if (day) query.set('day', day);
    if (status) query.set('status', status);
    const search = query.toString();
    return { success: true, data: await accountingRequest<Shift[]>(`shifts${search ? `?${search}` : ''}`) };
  } catch (error) { return failed(error, 'Shifts are unavailable. Refresh to try again.'); }
}

function refresh() {
  revalidatePath('/pos'); revalidatePath('/pos/shifts'); revalidatePath('/reconciliation/daily'); revalidatePath('/');
}

export async function openShiftAction(requestKey: string, openingFloat: string): Promise<Result<Shift>> {
  try {
    const data = await accountingRequest<Shift>('shifts', { method: 'POST', body: { request_key: requestKey, opening_float: openingFloat } });
    refresh();
    return { success: true, data };
  } catch (error) { return failed(error); }
}

export type MovementInput = {
  requestKey: string; kind: 'pay_in' | 'pay_out'; amount: string; reason: string; expenseAccountId?: string; bankAccountId?: string;
};

/** Doc 10: pay-ins and pay-outs need a reason and post as an expense or a transfer between the till and a bank. */
export async function cashMovementAction(shiftId: string, input: MovementInput): Promise<Result<Shift>> {
  try {
    const data = await accountingRequest<Shift>(`shifts/${encodeURIComponent(shiftId)}/movements`, { method: 'POST', body: {
      request_key: input.requestKey, kind: input.kind, amount: input.amount, reason: input.reason,
      expense_account_id: input.expenseAccountId || null, bank_account_id: input.bankAccountId || null } });
    refresh();
    return { success: true, data };
  } catch (error) { return failed(error); }
}

/** PR-22: the counted cash closes the shift; any difference posts to Cash over and short. */
export async function closeShiftAction(shiftId: string, requestKey: string, countedCash: string, note: string): Promise<Result<Shift>> {
  try {
    const data = await accountingRequest<Shift>(`shifts/${encodeURIComponent(shiftId)}/close`, { method: 'POST',
      body: { request_key: requestKey, counted_cash: countedCash, note } });
    refresh();
    return { success: true, data };
  } catch (error) { return failed(error); }
}

/** The owner's rule: when on, nobody sells without an open shift. */
export async function saveShiftPolicyAction(requireShift: boolean): Promise<Result<{ require_shift: boolean }>> {
  try {
    const data = await accountingRequest<{ require_shift: boolean }>('shifts/policy', { method: 'POST', body: { require_shift: requireShift } });
    refresh();
    return { success: true, data };
  } catch (error) { return failed(error); }
}
