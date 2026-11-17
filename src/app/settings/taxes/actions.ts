'use server';
// Settings › Taxes (E14 R3 part 2a). The accounting API checks who may change them and the dates.
import { accountingRequest } from '@/lib/accounting-client';
import type { VatClass, VatOverview, VatReturn, VatStatus } from '@/lib/vat';

type Result<T> = { success: true; data: T } | { success: false; error: string };
const failed = (error: unknown) => ({ success: false as const, error: error instanceof Error ? error.message : 'That did not work. Try again.' });

export async function vatAction(): Promise<Result<VatOverview>> {
  try { return { success: true, data: await accountingRequest<VatOverview>('vat') }; } catch (error) { return failed(error); }
}

export async function saveVatAction(settings: { registered: boolean; vat_number: string | null; effective_from: string | null; invoices_include_vat: boolean }): Promise<Result<VatOverview>> {
  try { return { success: true, data: await accountingRequest<VatOverview>('vat', { method: 'POST', body: settings }) }; } catch (error) { return failed(error); }
}

export async function saveVatClassesAction(items: { item_id: string; vat_class: VatClass }[]): Promise<Result<VatOverview>> {
  try { return { success: true, data: await accountingRequest<VatOverview>('vat/items', { method: 'POST', body: { items } }) }; } catch (error) { return failed(error); }
}

export async function vatReturnAction(month: string): Promise<Result<VatReturn>> {
  try { return { success: true, data: await accountingRequest<VatReturn>(`reports/vat-return?${new URLSearchParams({ month })}`) }; } catch (error) { return failed(error); }
}

/** For any member's purchase forms: whether VAT applies today, and the rate. */
export async function vatStatusAction(): Promise<Result<VatStatus>> {
  try { return { success: true, data: await accountingRequest<VatStatus>('vat/status') }; } catch (error) { return failed(error); }
}
