'use server';
// Payroll to the books (Doc 03 FR-203; E21 R4). The accounting API checks CACU's switch, payroll.approve and that the
// person is an Owner or Admin; it builds the journal from the approved run's own totals.
import { z } from 'zod';
import { accountingRequest } from '@/lib/accounting-client';
import type { PayrollBooks, PayrollBooksRun, SettleInput } from '@/lib/payroll-books';

type Result<T> = { success: true; data: T } | { success: false; error: string };
const id = z.string().uuid();

export async function payrollBooksAction(): Promise<Result<PayrollBooks>> {
  try { return { success: true, data: await accountingRequest<PayrollBooks>('payroll/books') }; }
  catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Payroll in the books could not be loaded.' }; }
}

export async function postPayrollAction(runId: string, requestKey: string): Promise<Result<PayrollBooksRun>> {
  const run = id.safeParse(runId); const key = id.safeParse(requestKey);
  if (!run.success || !key.success) return { success: false, error: 'Payroll run not found' };
  try {
    return { success: true, data: await accountingRequest<PayrollBooksRun>(`payroll/runs/${encodeURIComponent(run.data)}/post`, { method: 'POST', body: { request_key: key.data } }) };
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'The payroll could not be posted. Try again.' }; }
}

const settle = z.object({
  kind: z.enum(['net_pay', 'paye', 'pension', 'nhf', 'nhis']),
  amount: z.string().regex(/^[0-9]{1,13}(\.[0-9]{1,2})?$/, 'Enter an amount, like 25000 or 25000.50.').refine(v => Number(v) > 0, 'Enter an amount above zero.'),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the date it was paid.'),
  method: z.enum(['Cash', 'Transfer']),
  bank_account_id: z.string().uuid().nullable().optional(),
  reference: z.string().trim().max(120).nullable().optional().transform(v => v ? v : null),
}).refine(v => v.method === 'Cash' ? !v.bank_account_id : !!v.bank_account_id, 'Choose the bank account it was paid from.');

export async function settlePayrollAction(runId: string, requestKey: string, input: SettleInput): Promise<Result<PayrollBooksRun>> {
  const run = id.safeParse(runId); const key = id.safeParse(requestKey); const body = settle.safeParse(input);
  if (!run.success || !key.success) return { success: false, error: 'Payroll run not found' };
  if (!body.success) return { success: false, error: body.error.issues[0]?.message ?? 'Check the payment and try again.' };
  const { bank_account_id, ...rest } = body.data;
  try {
    return { success: true, data: await accountingRequest<PayrollBooksRun>(`payroll/runs/${encodeURIComponent(run.data)}/payments`,
      { method: 'POST', body: { ...rest, ...(rest.method === 'Transfer' ? { bank_account_id } : {}), request_key: key.data } }) };
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'The payment could not be recorded. Try again.' }; }
}
