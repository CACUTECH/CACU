'use server';
// Jobs (Doc 10 services rules): completion issues materials from stock; billing by invoice; job profit on Chairman.
import { revalidatePath } from 'next/cache';
import { AccountingRequestError, accountingRequest, usesPythonAccounting } from '@/lib/accounting-client';
import type { CostRates, JobMoney } from '@/lib/jobs';

type Result<T> = { success: true; data: T } | { success: false; error: string; uncertain: boolean };
function failed(error: unknown, fallback = 'The change was not confirmed. Refresh before trying again.'): { success: false; error: string; uncertain: boolean } {
  const known = error instanceof AccountingRequestError && error.status < 500;
  return { success: false, error: known ? error.message : fallback, uncertain: !known };
}

/** Revenue, materials at cost and, on Chairman for people who see the books, profit; null before the books are on. */
export async function getJobMoneyAction(jobId: string): Promise<Result<JobMoney | null>> {
  try {
    if (!(await usesPythonAccounting())) return { success: true, data: null };
    return { success: true, data: await accountingRequest<JobMoney>(`jobs/${encodeURIComponent(jobId)}`) };
  } catch (error) { return failed(error, 'Job figures are unavailable. Refresh to try again.'); }
}

/** Completing a job issues its materials from stock at cost. */
export async function completeJobAction(jobId: string, requestKey: string): Promise<Result<JobMoney>> {
  try {
    const data = await accountingRequest<JobMoney>(`jobs/${encodeURIComponent(jobId)}/complete`, { method: 'POST', body: { request_key: requestKey } });
    revalidatePath('/jobs'); revalidatePath('/catalog');
    return { success: true, data };
  } catch (error) { return failed(error); }
}

export type JobInvoiced = { job_id: string; invoice_id: string; invoice_number: string; total: string };

export async function billJobByInvoiceAction(jobId: string, input: { requestKey: string; customerId?: string }): Promise<Result<JobInvoiced>> {
  try {
    const data = await accountingRequest<JobInvoiced>(`jobs/${encodeURIComponent(jobId)}/invoice`, { method: 'POST',
      body: { request_key: input.requestKey, customer_id: input.customerId || null } });
    revalidatePath('/jobs'); revalidatePath('/invoices');
    return { success: true, data };
  } catch (error) { return failed(error); }
}

export async function getCostRatesAction(): Promise<Result<CostRates | null>> {
  try {
    if (!(await usesPythonAccounting())) return { success: true, data: null };
    return { success: true, data: await accountingRequest<CostRates>('jobs/cost-rates') };
  } catch (error) { return failed(error, 'Cost rates are unavailable.'); }
}

export async function saveCostRatesAction(rates: { staffId: string; hourly: string }[]): Promise<Result<CostRates>> {
  try {
    const data = await accountingRequest<CostRates>('jobs/cost-rates', { method: 'POST',
      body: { rates: rates.map(r => ({ staff_id: r.staffId, hourly: r.hourly })) } });
    revalidatePath('/jobs'); revalidatePath('/appointments/staff');
    return { success: true, data };
  } catch (error) { return failed(error); }
}
