// Customer notifications (Doc 10 E20): receipts by email, text and link; overdue invoice and booking reminders.
import { createClient } from '@/lib/supabase/client';

export type TextAllowance = { limit: number; used: number; remaining: number; resets_at: string };
export type Queued = 'queued' | 'already_queued' | 'allowance_used' | 'limit' | null;
export type Shared = { token: string; email: Queued; text: Queued; texts: TextAllowance };
export type NotificationOverview = {
  invoice_reminders: boolean; booking_reminders: boolean; can_edit: boolean; booking_allowed: boolean; texts: TextAllowance;
  recent: { kind: string; channel: 'email' | 'sms'; to: string; status: string; created_at: string }[];
};
type Result<T> = { success: true; data: T } | { success: false; error: string; uncertain: boolean };

const ERRORS: Record<string, string> = {
  PERMISSION_DENIED: 'You do not have permission to do this.',
  EMAIL_INVALID: 'Check the email address.',
  PHONE_INVALID: 'Enter a Nigerian mobile number, for example 0803 123 4567.',
  SALE_NOT_FOUND: 'This sale could not be found.',
  PLAN_READ_ONLY: 'Your workspace is read-only until you pay. Settings cannot change.',
};

/** Calls a database function; a known refusal is definite, anything else may or may not have happened. */
export async function rpc<T>(name: string, args: Record<string, unknown>): Promise<Result<T>> {
  try {
    const { data, error } = await createClient().rpc(name, args);
    if (!error) return { success: true, data: data as T };
    const known = Object.keys(ERRORS).find(code => error.message?.includes(code));
    return known ? { success: false, error: ERRORS[known], uncertain: false }
      : { success: false, error: 'The change was not confirmed. Try again.', uncertain: true };
  } catch { return { success: false, error: 'The change was not confirmed. Try again.', uncertain: true }; }
}

export const receiptLink = (token: string) => `${typeof window === 'undefined' ? '' : window.location.origin}/r/${token}`;

/** What happened to each channel, in one sentence. */
export function sharedText(shared: Shared) {
  const parts: string[] = [];
  if (shared.email === 'queued' || shared.email === 'already_queued') parts.push('by email');
  if (shared.text === 'queued' || shared.text === 'already_queued') parts.push('by text');
  const sent = parts.length ? `Receipt sent ${parts.join(' and ')}.` : 'Receipt link ready.';
  if (shared.text === 'allowance_used') {
    return `${sent} This month's ${shared.texts.limit} texts are used, so no text was sent${shared.email ? '; it went by email instead' : ''}.`;
  }
  if (shared.email === 'limit' || shared.text === 'limit') return `${sent} This receipt has been sent too many times already.`;
  return sent;
}
