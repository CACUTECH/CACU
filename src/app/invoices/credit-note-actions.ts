'use server';
// Credit notes on invoices (Doc 10 E12, Doc 09 PR-16): they post to the books, so they need the accounting API.
import { revalidatePath } from 'next/cache';
import { AccountingRequestError, accountingRequest, usesPythonAccounting } from '@/lib/accounting-client';
import type { CreditLineInput, CreditNote, CreditNoteList, CreditStatus, Creditable } from '@/lib/credit-notes';

type Result<T> = { success: true; data: T } | { success: false; error: string; uncertain: boolean };
const OFF = 'Turn on your books to use credit notes. They work once CACU keeps your accounts.';
function failed(error: unknown, fallback = 'The credit note was not confirmed. Retry with the same details to check whether it was recorded.'): { success: false; error: string; uncertain: boolean } {
  const known = error instanceof AccountingRequestError && error.status < 500;
  return { success: false, error: known ? error.message : fallback, uncertain: !known };
}
const id = (value: string) => encodeURIComponent(value);

export async function creditableAction(invoiceId: string): Promise<Result<Creditable>> {
  try {
    if (!(await usesPythonAccounting())) return { success: false, error: OFF, uncertain: false };
    return { success: true, data: await accountingRequest<Creditable>(`invoices/${id(invoiceId)}/creditable`) };
  } catch (error) { return failed(error, 'This invoice cannot be loaded for a credit note. Try again.'); }
}

export async function requestCreditNoteAction(credit: { request_key: string; invoice_id: string; reason: string; lines: CreditLineInput[] }): Promise<Result<CreditNote>> {
  try {
    if (!(await usesPythonAccounting())) return { success: false, error: OFF, uncertain: false };
    const data = await accountingRequest<CreditNote>('credit-notes', { method: 'POST', body: credit });
    revalidatePath('/invoices');
    return { success: true, data };
  } catch (error) { return failed(error); }
}

export async function creditNotesAction(status: CreditStatus): Promise<Result<CreditNoteList>> {
  try {
    if (!(await usesPythonAccounting())) return { success: false, error: OFF, uncertain: false };
    return { success: true, data: await accountingRequest<CreditNoteList>(`credit-notes?status=${id(status)}`) };
  } catch (error) { return failed(error, 'Credit notes are unavailable. Try again.'); }
}

export async function decideCreditNoteAction(creditId: string, approve: boolean, note: string): Promise<Result<CreditNote>> {
  try {
    const data = await accountingRequest<CreditNote>(`credit-notes/${id(creditId)}/${approve ? 'approve' : 'reject'}`, { method: 'POST', body: { note } });
    revalidatePath('/invoices');
    return { success: true, data };
  } catch (error) { return failed(error, 'The decision was not confirmed. Refresh to see whether it was recorded.'); }
}
