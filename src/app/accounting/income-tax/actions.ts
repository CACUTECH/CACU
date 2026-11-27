'use server';
// Company income tax estimate (R4; Nigeria Tax Act 2025). The accounting API checks CACU's switch and that changes come
// from an Owner or Admin; nothing here posts to the books.
import { z } from 'zod';
import { accountingRequest } from '@/lib/accounting-client';
import type { IncomeTaxEstimate } from '@/lib/income-tax';

type Result = { success: true; data: IncomeTaxEstimate } | { success: false; error: string };
const failed = (error: unknown, fallback: string): Result => ({ success: false, error: error instanceof Error ? error.message : fallback });
const year = z.number().int().min(2026).max(2100);
const amount = z.string().trim().regex(/^[0-9]{1,13}(\.[0-9]{1,2})?$/, 'Enter amounts like 250000 or 250000.50.');

export async function incomeTaxAction(value: number): Promise<Result> {
  if (!year.safeParse(value).success) return { success: false, error: 'Choose a year from 2026.' };
  try { return { success: true, data: await accountingRequest<IncomeTaxEstimate>(`income-tax/${value}`) }; }
  catch (error) { return failed(error, 'The estimate could not be worked out.'); }
}

export async function saveTaxYearAction(value: number, input: { losses_brought_forward: string; professional_services: boolean }): Promise<Result> {
  const body = z.object({ losses_brought_forward: amount, professional_services: z.boolean() }).safeParse(input);
  if (!year.safeParse(value).success) return { success: false, error: 'Choose a year from 2026.' };
  if (!body.success) return { success: false, error: body.error.issues[0]?.message ?? 'Check the figures and try again.' };
  try { return { success: true, data: await accountingRequest<IncomeTaxEstimate>(`income-tax/${value}`, { method: 'PUT', body: body.data }) }; }
  catch (error) { return failed(error, 'That was not saved. Try again.'); }
}

export async function addTaxAdjustmentAction(value: number, requestKey: string, input: { direction: 'add' | 'deduct'; label: string; amount: string }): Promise<Result> {
  const body = z.object({ direction: z.enum(['add', 'deduct']), label: z.string().trim().min(2, 'Say what it is.').max(120),
    amount: amount.refine(v => Number(v) > 0, 'Enter an amount above zero.') }).safeParse(input);
  const key = z.string().uuid().safeParse(requestKey);
  if (!year.safeParse(value).success || !key.success) return { success: false, error: 'Refresh the page and try again.' };
  if (!body.success) return { success: false, error: body.error.issues[0]?.message ?? 'Check the adjustment and try again.' };
  try { return { success: true, data: await accountingRequest<IncomeTaxEstimate>(`income-tax/${value}/adjustments`, { method: 'POST', body: { ...body.data, request_key: key.data } }) }; }
  catch (error) { return failed(error, 'The adjustment was not added. Try again.'); }
}

export async function saveYearEndAction(month: number): Promise<{ success: true } | { success: false; error: string }> {
  if (!Number.isInteger(month) || month < 1 || month > 12) return { success: false, error: 'Choose the month your accounts end.' };
  try { await accountingRequest('income-tax/settings', { method: 'PUT', body: { year_end_month: month } }); return { success: true }; }
  catch (error) { return { success: false, error: error instanceof Error ? error.message : 'That was not saved. Try again.' }; }
}

export async function removeTaxAdjustmentAction(value: number, id: string): Promise<Result> {
  if (!year.safeParse(value).success || !z.string().uuid().safeParse(id).success) return { success: false, error: 'Adjustment not found' };
  try { return { success: true, data: await accountingRequest<IncomeTaxEstimate>(`income-tax/${value}/adjustments/${encodeURIComponent(id)}`, { method: 'DELETE' }) }; }
  catch (error) { return failed(error, 'The adjustment was not removed. Try again.'); }
}

const uuid = z.string().uuid();

export async function postTaxAction(value: number, requestKey: string): Promise<Result> {
  if (!year.safeParse(value).success || !uuid.safeParse(requestKey).success) return { success: false, error: 'Refresh the page and try again.' };
  try { return { success: true, data: await accountingRequest<IncomeTaxEstimate>(`income-tax/${value}/post`, { method: 'POST', body: { request_key: requestKey } }) }; }
  catch (error) { return failed(error, 'The tax was not posted. Try again.'); }
}

export async function payTaxAction(value: number, requestKey: string, input: { amount: string; entry_date: string; method: 'Cash' | 'Transfer'; bank_account_id: string | null; reference: string }): Promise<Result> {
  const body = z.object({ amount: amount.refine(v => Number(v) > 0, 'Enter an amount above zero.'), entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the date it was paid.'),
    method: z.enum(['Cash', 'Transfer']), bank_account_id: uuid.nullable(), reference: z.string().trim().max(120) })
    .refine(v => v.method === 'Cash' || !!v.bank_account_id, 'Choose the bank it was paid from.').safeParse(input);
  if (!year.safeParse(value).success || !uuid.safeParse(requestKey).success) return { success: false, error: 'Refresh the page and try again.' };
  if (!body.success) return { success: false, error: body.error.issues[0]?.message ?? 'Check the payment and try again.' };
  const { bank_account_id, reference, ...rest } = body.data;
  try {
    return { success: true, data: await accountingRequest<IncomeTaxEstimate>(`income-tax/${value}/payments`, { method: 'POST',
      body: { ...rest, request_key: requestKey, ...(rest.method === 'Transfer' ? { bank_account_id } : {}), ...(reference ? { reference } : {}) } }) };
  } catch (error) { return failed(error, 'The payment was not recorded. Try again.'); }
}

export async function reverseTaxAction(value: number, requestKey: string, reason: string, paymentId?: string): Promise<Result> {
  if (!year.safeParse(value).success || !uuid.safeParse(requestKey).success || (paymentId && !uuid.safeParse(paymentId).success)) return { success: false, error: 'Refresh the page and try again.' };
  if (reason.trim().length < 5) return { success: false, error: 'Say why it is being reversed.' };
  const path = paymentId ? `income-tax/${value}/payments/${encodeURIComponent(paymentId)}/reverse` : `income-tax/${value}/reverse`;
  try { return { success: true, data: await accountingRequest<IncomeTaxEstimate>(path, { method: 'POST', body: { request_key: requestKey, reason: reason.trim() } }) }; }
  catch (error) { return failed(error, 'It was not reversed. Try again.'); }
}

export async function bankAccountsAction(): Promise<{ success: true; data: { id: string; name: string }[] } | { success: false; error: string }> {
  try { return { success: true, data: (await accountingRequest<{ id: string; name: string }[]>('collection-accounts')).map(b => ({ id: b.id, name: b.name })) }; }
  catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Bank accounts unavailable' }; }
}
