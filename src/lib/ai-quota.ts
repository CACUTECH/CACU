// A business's AI allowance this month, as public.get_ai_chat_quota returns it (Doc 14 TEST-210).
export type AIQuota = { billed: boolean; limit: number | null; used: number; remaining: number | null; resets_at: string };

export const AI_NOT_ON_PLAN = 'AI questions are not on your plan. Upgrade in Billing to use them.';
export const AI_SUSPENDED = 'Your workspace is read-only until the subscription is paid. AI questions resume after payment.';

const isQuota = (value: unknown): value is AIQuota =>
  typeof value === 'object' && value !== null && 'used' in value && 'resets_at' in value;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });

/** "37 of 100 AI questions left this month. Resets on 1 Dec 2026." Null when the plan sets no monthly limit. */
export function allowanceLine(quota: unknown) {
  if (!isQuota(quota) || !quota.billed || quota.limit === null) return null;
  if (quota.limit === 0) return AI_NOT_ON_PLAN;
  return `${quota.remaining ?? 0} of ${quota.limit} AI questions left this month. Resets on ${day(quota.resets_at)}.`;
}

/** The refusal at the monthly limit: zero remaining, and when it resets. */
export function limitReachedLine(quota: unknown) {
  if (isQuota(quota) && quota.limit === 0) return AI_NOT_ON_PLAN;
  if (!isQuota(quota) || quota.limit === null) return 'This month\'s AI questions are used up (0 left). Upgrade in Billing for more.';
  return `You've used all ${quota.limit} AI questions on your plan this month (0 left). They reset on ${day(quota.resets_at)}. Upgrade in Billing for more.`;
}
