// Closing a business (Doc 10 E22 part 3, FR-210): what the app shows, and the database's refusals in plain words.
export type ClosureStatus = { closed: boolean; closed_at: string | null; purge_after: string | null; can_reopen: boolean; is_owner: boolean;
  staff: number; staff_restored?: number };

const REFUSALS: [string, string][] = [
  ['CONFIRM_NAME_MISMATCH', 'Type the business name exactly as it appears in your settings.'],
  ['REASON_REQUIRED', 'Say briefly why you are closing the business.'],
  ['ALREADY_CLOSED', 'This business is already closed.'],
  ['NOT_CLOSED', 'This business is not closed.'],
  ['REOPEN_WINDOW_ENDED', 'The 90 days to reopen have passed.'],
  ['MFA_REQUIRED', 'Finish two-step sign-in first.'],
  ['ACCESS_DENIED', 'Only the business owner can do this.'],
];

export function closureError(message: string | undefined): string {
  return REFUSALS.find(([code]) => message?.includes(code))?.[1] ?? 'That did not work. Try again.';
}

export const longDate = (value: string | null) => value ? new Date(value).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
