'use server';
// Fixed assets (R4; IAS 16). The accounting API checks that the person is an Owner or Admin for every change, posts
// months in order and refuses closed months; these actions only shape the requests.
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { accountingRequest } from '@/lib/accounting-client';
import { createClient } from '@/lib/supabase/server';
import { getActiveBusinessIdAction } from '@/app/business-actions';
import type { AssetInput, DepreciationPreview, DisposeInput, FixedAsset, FixedAssets } from '@/lib/fixed-assets';

type Result<T> = { success: true; data: T } | { success: false; error: string };
const failed = (error: unknown, fallback: string) => ({ success: false as const, error: error instanceof Error ? error.message : fallback });
const id = z.string().uuid();
const amount = z.string().trim().regex(/^[0-9]{1,13}(\.[0-9]{1,2})?$/, 'Enter amounts like 250000 or 250000.50.');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export async function fixedAssetsAction(): Promise<Result<FixedAssets & { suppliers: { id: string; name: string }[] }>> {
  try {
    const supabase = await createClient(); const businessId = await getActiveBusinessIdAction();
    const [assets, suppliers] = await Promise.all([accountingRequest<FixedAssets>('fixed-assets'),
      supabase.from('suppliers').select('id,name').eq('business_id', businessId).order('name')]);
    return { success: true, data: { ...assets, suppliers: suppliers.error ? [] : suppliers.data || [] } };
  } catch (error) { return failed(error, 'Fixed assets could not be loaded.'); }
}

const asset = z.object({
  name: z.string().trim().min(1, 'Enter the asset name.').max(120),
  category: z.enum(['buildings', 'vehicles', 'machinery', 'furniture', 'computers', 'other']),
  reference: z.string().trim().max(60).optional().transform(v => v || null),
  acquired_on: day, cost: amount.refine(v => Number(v) > 0, 'Enter the cost, above zero.'), residual: amount,
  method: z.enum(['straight_line', 'reducing_balance']),
  useful_life_months: z.number().int().min(1).max(1200).nullable().optional(),
  annual_rate_percent: z.string().regex(/^[0-9]{1,3}(\.[0-9]{1,2})?$/, 'Enter the yearly rate, like 25.').nullable().optional(),
  how: z.enum(['paid', 'credit', 'existing']),
  vat: amount.optional(),
  pay_method: z.enum(['Cash', 'Transfer']).nullable().optional(), bank_account_id: id.nullable().optional(),
  supplier_id: id.nullable().optional(), bill_number: z.string().trim().max(100).nullable().optional(), due_date: day.nullable().optional(),
  accumulated_depreciation: amount.optional(), brought_in_on: day.nullable().optional(),
}).superRefine((v, ctx) => {
  const need = (ok: unknown, message: string) => { if (!ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message }); };
  need(v.method === 'straight_line' ? v.useful_life_months : v.annual_rate_percent, v.method === 'straight_line' ? 'Enter the useful life.' : 'Enter the yearly rate.');
  if (v.how === 'paid') need(v.pay_method && (v.pay_method === 'Cash' || v.bank_account_id), 'Choose the till or the bank it was paid from.');
  if (v.how === 'credit') need(v.supplier_id && v.bill_number, "Choose the supplier and enter their bill number.");
  if (v.how === 'existing') need(v.brought_in_on, 'Choose the day it is brought into the books.');
});

/** Only the fields that belong to how the asset was bought are sent. */
function body(v: z.infer<typeof asset>) {
  const { pay_method, bank_account_id, supplier_id, bill_number, due_date, accumulated_depreciation, brought_in_on, useful_life_months, annual_rate_percent, vat, ...rest } = v;
  return {
    ...rest,
    ...(v.method === 'straight_line' ? { useful_life_months } : { annual_rate_percent }),
    ...(v.how === 'paid' ? { pay_method, ...(pay_method === 'Transfer' ? { bank_account_id } : {}) } : {}),
    ...(v.how === 'credit' ? { supplier_id, bill_number, ...(due_date ? { due_date } : {}) } : {}),
    ...(v.how === 'existing' ? { accumulated_depreciation: accumulated_depreciation || '0.00', brought_in_on } : { vat: vat || '0.00' }),
  };
}

export async function addAssetAction(requestKey: string, input: AssetInput): Promise<Result<FixedAsset>> {
  const key = id.safeParse(requestKey); const parsed = asset.safeParse(input);
  if (!key.success) return { success: false, error: 'Refresh the page and try again.' };
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Check the asset and try again.' };
  try {
    const data = await accountingRequest<FixedAsset>('fixed-assets', { method: 'POST', body: { request_key: key.data, ...body(parsed.data) } });
    revalidatePath('/accounting/fixed-assets');
    return { success: true, data };
  } catch (error) { return failed(error, 'The asset was not added. Try again.'); }
}

export async function previewDepreciationAction(value: string): Promise<Result<DepreciationPreview>> {
  if (!month.safeParse(value).success) return { success: false, error: 'Choose a month.' };
  try { return { success: true, data: await accountingRequest<DepreciationPreview>(`fixed-assets/depreciation/${value}`) }; }
  catch (error) { return failed(error, 'The depreciation could not be worked out.'); }
}

export async function postDepreciationAction(value: string, requestKey: string): Promise<Result<{ total: string }>> {
  const key = id.safeParse(requestKey);
  if (!month.safeParse(value).success || !key.success) return { success: false, error: 'Choose a month.' };
  try {
    const data = await accountingRequest<{ total: string }>(`fixed-assets/depreciation/${value}`, { method: 'POST', body: { request_key: key.data } });
    revalidatePath('/accounting/fixed-assets');
    return { success: true, data };
  } catch (error) { return failed(error, 'The depreciation was not posted. Try again.'); }
}

const disposal = z.object({
  disposed_on: day, proceeds: amount, method: z.enum(['Cash', 'Transfer']).nullable().optional(), bank_account_id: id.nullable().optional(),
}).refine(v => Number(v.proceeds) === 0 || (v.method && (v.method === 'Cash' || v.bank_account_id)), 'Choose the till or the bank the money went into.');

export async function disposeAssetAction(assetId: string, requestKey: string, input: DisposeInput): Promise<Result<FixedAsset>> {
  const target = id.safeParse(assetId); const key = id.safeParse(requestKey); const parsed = disposal.safeParse(input);
  if (!target.success || !key.success) return { success: false, error: 'Fixed asset not found' };
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Check the disposal and try again.' };
  const { method, bank_account_id, ...rest } = parsed.data;
  const sold = Number(rest.proceeds) > 0;
  try {
    const data = await accountingRequest<FixedAsset>(`fixed-assets/${encodeURIComponent(target.data)}/dispose`, { method: 'POST',
      body: { request_key: key.data, ...rest, ...(sold ? { method, ...(method === 'Transfer' ? { bank_account_id } : {}) } : {}) } });
    revalidatePath('/accounting/fixed-assets');
    return { success: true, data };
  } catch (error) { return failed(error, 'The disposal was not recorded. Try again.'); }
}
