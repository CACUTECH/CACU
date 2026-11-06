'use server';
// Booking deposits and the bookings that hold them (Doc 10 services rules, PR-12). Deposits need the books turned on.
import { revalidatePath } from 'next/cache';
import { AccountingRequestError, accountingRequest, usesPythonAccounting } from '@/lib/accounting-client';
import type { BookingBill, BookingSettings, Deposit } from '@/lib/bookings';

type Result<T> = { success: true; data: T } | { success: false; error: string; uncertain: boolean };
function failed(error: unknown, fallback = 'The change was not confirmed. Refresh before trying again.'): { success: false; error: string; uncertain: boolean } {
  const known = error instanceof AccountingRequestError && error.status < 500;
  return { success: false, error: known ? error.message : fallback, uncertain: !known };
}

/** The owner's booking rules and the deposits on bookings in a range of days; null before the books are turned on. */
export async function getBookingMoneyAction(start: string, end: string): Promise<Result<{ settings: BookingSettings; deposits: Deposit[] } | null>> {
  try {
    if (!(await usesPythonAccounting())) return { success: true, data: null };
    const [settings, deposits] = await Promise.all([
      accountingRequest<BookingSettings>('bookings/settings'),
      accountingRequest<Deposit[]>(`bookings/deposits?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`),
    ]);
    return { success: true, data: { settings, deposits } };
  } catch (error) { return failed(error, 'Deposits are unavailable. Refresh to try again.'); }
}

export async function getBookingSettingsAction(): Promise<Result<BookingSettings | null>> {
  try {
    if (!(await usesPythonAccounting())) return { success: true, data: null };
    return { success: true, data: await accountingRequest<BookingSettings>('bookings/settings') };
  } catch (error) { return failed(error, 'Booking settings are unavailable. Refresh to try again.'); }
}

export type SettingsInput = { freeCancelHours: number; lateDeposit: 'keep' | 'refund'; rules: { serviceId: string; kind: 'none' | 'fixed' | 'percent'; value: string }[] };

export async function saveBookingSettingsAction(input: SettingsInput): Promise<Result<BookingSettings>> {
  try {
    const data = await accountingRequest<BookingSettings>('bookings/settings', { method: 'POST', body: {
      free_cancel_hours: input.freeCancelHours, late_deposit: input.lateDeposit,
      rules: input.rules.map(r => ({ service_id: r.serviceId, kind: r.kind, value: r.kind === 'none' ? '0' : r.value })) } });
    revalidatePath('/appointments'); revalidatePath('/appointments/settings'); revalidatePath('/accounting/chart');
    return { success: true, data };
  } catch (error) { return failed(error); }
}

/** PR-12: cash goes into the till; a transfer waits for confirmation on Daily reconciliation. */
export async function takeDepositAction(bookingId: string, input: { requestKey: string; amount: string; method: 'Cash' | 'Transfer'; bankAccountId?: string }): Promise<Result<Deposit>> {
  try {
    const data = await accountingRequest<Deposit>(`bookings/${encodeURIComponent(bookingId)}/deposit`, { method: 'POST', body: {
      request_key: input.requestKey, amount: input.amount, method: input.method, bank_account_id: input.bankAccountId || null } });
    revalidatePath('/appointments'); revalidatePath('/reconciliation/daily'); revalidatePath('/pos');
    return { success: true, data };
  } catch (error) { return failed(error); }
}

export type CloseInput = { requestKey: string; reason: string; deposit?: 'keep' | 'refund'; bankAccountId?: string };
export type Closed = { id: string; status: 'cancelled' | 'no_show'; deposit: 'keep' | 'refund' | null; deposit_amount: string | null };

/** Cancels a booking, or marks it no-show, settling any deposit with it. */
export async function closeBookingAction(bookingId: string, how: 'cancel' | 'no-show', input: CloseInput): Promise<Result<Closed>> {
  try {
    const data = await accountingRequest<Closed>(`bookings/${encodeURIComponent(bookingId)}/${how}`, { method: 'POST', body: {
      request_key: input.requestKey, reason: input.reason, deposit: input.deposit ?? null, bank_account_id: input.bankAccountId || null } });
    revalidatePath('/appointments'); revalidatePath('/pos');
    return { success: true, data };
  } catch (error) { return failed(error); }
}

/** What the till needs to bill a completed booking: its service, price and any deposit to apply. */
export async function getBookingBillAction(bookingId: string): Promise<Result<BookingBill>> {
  try { return { success: true, data: await accountingRequest<BookingBill>(`bookings/${encodeURIComponent(bookingId)}/bill`) }; }
  catch (error) { return failed(error, 'The booking is unavailable. Refresh to try again.'); }
}

export type Invoiced = { appointment_id: string; invoice_id: string; invoice_number: string; total: string; deposit_applied: string; outstanding: string };

/** PR-11: an invoice for the service to the booking's customer, with any held deposit applied. */
export async function billByInvoiceAction(bookingId: string, input: { requestKey: string; customerId?: string }): Promise<Result<Invoiced>> {
  try {
    const data = await accountingRequest<Invoiced>(`bookings/${encodeURIComponent(bookingId)}/invoice`, { method: 'POST',
      body: { request_key: input.requestKey, customer_id: input.customerId || null } });
    revalidatePath('/appointments'); revalidatePath('/invoices');
    return { success: true, data };
  } catch (error) { return failed(error); }
}
