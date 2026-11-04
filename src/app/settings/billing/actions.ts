'use server';
import { revalidatePath } from 'next/cache';
import { AccountingRequestError, accountingRequest } from '@/lib/accounting-client';
import { createClient } from '@/lib/supabase/server';
import { getActiveBusinessIdAction } from '@/app/business-actions';
import { isCheckoutUrl, type BillingInterval, type BillingInvoice, type CheckoutResult, type CurrentPlan, type DowngradeChoices, type Plan, type PlanCode, type Quote, type ScheduleResult, type VerifyOutcome } from '@/lib/billing';

type Result<T> = { success: true; data: T } | { success: false; error: string };
const failed = (error: unknown, fallback: string) => ({ success: false as const,
  error: error instanceof AccountingRequestError && error.status < 500 ? error.message : fallback });

export async function getBillingAction(manager: boolean): Promise<Result<{ plans: Plan[]; current: CurrentPlan; history: BillingInvoice[] | null }>> {
  try {
    const supabase = await createClient(); const businessId = await getActiveBusinessIdAction();
    const [plans, current, history] = await Promise.all([
      supabase.rpc('billing_plans'),
      supabase.rpc('business_plan', { p_business_id: businessId }),
      // Invoices are for Owners and Admins only; the database refuses anyone else as well.
      manager ? supabase.rpc('business_billing_history', { p_business_id: businessId }) : Promise.resolve({ data: null, error: null })]);
    if (plans.error || current.error || history.error || !Array.isArray(plans.data) || !current.data) throw new Error('unavailable');
    return { success: true, data: { plans: plans.data as Plan[], current: current.data as CurrentPlan, history: history.data as BillingInvoice[] | null } };
  } catch {
    return { success: false, error: 'Billing details are unavailable. Refresh and try again.' };
  }
}

/** The active business's plan only, for the app-wide banner and feature gates. */
export async function getCurrentPlanAction(): Promise<Result<CurrentPlan>> {
  try {
    const supabase = await createClient(); const businessId = await getActiveBusinessIdAction();
    const { data, error } = await supabase.rpc('business_plan', { p_business_id: businessId });
    if (error || !data) throw new Error('unavailable');
    return { success: true, data: data as CurrentPlan };
  } catch { return { success: false, error: 'Billing details are unavailable.' }; }
}

export async function startCheckoutAction(input: { request_key: string; plan: PlanCode; interval: BillingInterval }): Promise<Result<CheckoutResult>> {
  try {
    const data = await accountingRequest<CheckoutResult>('billing/checkout', { method: 'POST', body: input });
    if (!isCheckoutUrl(data.authorization_url)) throw new Error('Unexpected checkout link');
    return { success: true, data };
  } catch (error) { return failed(error, 'Checkout could not start. Try again; you have not been charged.'); }
}

export async function payRenewalAction(): Promise<Result<CheckoutResult>> {
  try {
    const data = await accountingRequest<CheckoutResult>('billing/renewal', { method: 'POST', body: {} });
    if (!isCheckoutUrl(data.authorization_url)) throw new Error('Unexpected checkout link');
    return { success: true, data };
  } catch (error) { return failed(error, 'Checkout could not start. Try again; you have not been charged.'); }
}

const PLAN_END_REFUSALS: Record<string, string> = {
  BILLING_OWNER_REQUIRED: 'Only the business owner can cancel the subscription.',
  BILLING_CANCEL_NEEDS_ACTIVE_PLAN: 'There is no running plan or trial to cancel.',
  BILLING_NO_DOWNGRADE_SCHEDULED: 'No move to a smaller plan is coming up.',
  BILLING_KEEP_NOT_IN_BUSINESS: 'Someone or an outlet you chose is no longer active. Refresh and choose again.',
  'PLAN_LIMIT users.max': 'Choose no more people than the plan has seats for. Owners count as one each.',
  'PLAN_LIMIT outlets.max': 'Choose no more outlets than the plan allows.',
};
const planEndError = (error: { message?: string } | null) => PLAN_END_REFUSALS[error?.message ?? ''] ?? 'That change was not saved. Try again.';

/** SUB-11: the owner cancels at the end of the period, or takes it back. */
export async function cancelSubscriptionAction(cancel: boolean): Promise<Result<{ cancel_at_period_end: boolean; ends_at: string | null }>> {
  try {
    const supabase = await createClient(); const businessId = await getActiveBusinessIdAction();
    const { data, error } = await supabase.rpc('cancel_subscription', { p_business_id: businessId, p_cancel: cancel });
    if (error || !data) return { success: false, error: planEndError(error) };
    revalidatePath('/settings/billing');
    return { success: true, data };
  } catch { return { success: false, error: 'That change was not saved. Try again.' }; }
}

/** SUB-06: who stays active on the smaller plan. */
export async function getDowngradeChoicesAction(): Promise<Result<DowngradeChoices>> {
  try {
    const supabase = await createClient(); const businessId = await getActiveBusinessIdAction();
    const { data, error } = await supabase.rpc('downgrade_choices', { p_business_id: businessId });
    if (error || !data) return { success: false, error: planEndError(error) };
    return { success: true, data: data as DowngradeChoices };
  } catch { return { success: false, error: 'That change was not saved. Try again.' }; }
}

export async function saveDowngradeChoicesAction(users: string[], outlets: string[]): Promise<Result<DowngradeChoices>> {
  try {
    const supabase = await createClient(); const businessId = await getActiveBusinessIdAction();
    const { data, error } = await supabase.rpc('save_downgrade_choices', { p_business_id: businessId, p_users: users, p_outlets: outlets });
    if (error || !data) return { success: false, error: planEndError(error) };
    return { success: true, data: data as DowngradeChoices };
  } catch { return { success: false, error: 'That change was not saved. Try again.' }; }
}

export async function removeCardAction(): Promise<Result<null>> {
  try {
    const supabase = await createClient(); const businessId = await getActiveBusinessIdAction();
    const { error } = await supabase.rpc('remove_payment_method', { p_business_id: businessId });
    if (error) throw new Error('unavailable');
    revalidatePath('/settings/billing');
    return { success: true, data: null };
  } catch { return { success: false, error: 'The card was not removed. Try again.' }; }
}

export async function quoteAction(plan: PlanCode, interval: BillingInterval): Promise<Result<Quote>> {
  try {
    const supabase = await createClient(); const businessId = await getActiveBusinessIdAction();
    const { data, error } = await supabase.rpc('billing_quote', { p_business_id: businessId, p_plan: plan, p_interval: interval });
    if (error || !data) return { success: false, error: QUOTE_REFUSALS[error?.message ?? ''] ?? 'The price could not be worked out. Refresh and try again.' };
    return { success: true, data: data as Quote };
  } catch { return { success: false, error: 'The price could not be worked out. Refresh and try again.' }; }
}
const QUOTE_REFUSALS: Record<string, string> = {
  BILLING_RENEW_FIRST: 'This period ends within a day. Renew first, then change plan.',
  BILLING_DOWNGRADE_IS_SCHEDULED: 'A move to a smaller plan is scheduled for the end of the period, not paid now.',
  BILLING_INTERVAL_CHANGES_AT_RENEWAL: 'Switching from yearly to monthly is scheduled for the end of the year, not paid now.',
  'PLAN_LIMIT module.modes': 'Hybrid mode is on the Chairman Plan only. Switch to Products or Services first.',
};

export async function schedulePlanAction(plan: PlanCode, interval?: BillingInterval): Promise<Result<ScheduleResult>> {
  try {
    const data = await accountingRequest<ScheduleResult>('billing/schedule', { method: 'POST', body: interval ? { plan, interval } : { plan } });
    revalidatePath('/settings/billing');
    return { success: true, data };
  } catch (error) { return failed(error, 'The plan change was not saved. Try again.'); }
}

export async function verifyPaymentAction(reference: string): Promise<Result<VerifyOutcome>> {
  try {
    const data = await accountingRequest<VerifyOutcome>('billing/verify', { method: 'POST', body: { reference } });
    revalidatePath('/settings/billing');
    return { success: true, data };
  } catch (error) { return failed(error, 'We could not confirm the payment yet. Refresh in a minute; it will show once Paystack confirms it.'); }
}
