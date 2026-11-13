// Support access (Doc 10 E22 part 4, FR-212): what the app shows, and the database's refusals in plain words.
export type SupportGrant = { id: string; reason: string; include_pay: boolean; granted_at: string; expires_at: string };
export type SupportEvent = { event: 'granted' | 'opened' | 'ended'; at: string; reason: string; include_pay: boolean; expires_at: string; by: string };
export type SupportStatus = { active: SupportGrant | null; history: SupportEvent[] };
export type SupportCase = { business_id: string; name: string; reason: string; include_pay: boolean; expires_at: string; opened: boolean };
export type SupportCases = { staff: boolean; two_step: boolean; cases: SupportCase[] };

/** How long the Owner can let support in: one case at a time, never open-ended. */
export const SUPPORT_LENGTHS = [
  { hours: 1, label: '1 hour' }, { hours: 24, label: '24 hours' }, { hours: 72, label: '3 days' }, { hours: 168, label: '7 days' },
] as const;

const REFUSALS: [string, string][] = [
  ['SUPPORT_LENGTH_INVALID', 'Choose how long support can look: 1 hour, 24 hours, 3 days or 7 days.'],
  ['REASON_REQUIRED', 'Say briefly what support should look at.'],
  ['SUPPORT_ALREADY_GRANTED', 'Support already has access. End it first to grant it again.'],
  ['NO_SUPPORT_ACCESS', 'Support does not have access to this business now.'],
  ['MFA_REQUIRED', 'Finish two-step sign-in first.'],
  ['SUPPORT_READ_ONLY', 'CACU support access is read-only.'],
  ['ACCESS_DENIED', 'Only the business owner can do this.'],
];

export function supportError(message: string | undefined): string {
  return REFUSALS.find(([code]) => message?.includes(code))?.[1] ?? 'That did not work. Try again.';
}

export const dateTime = (value: string | null | undefined) => value
  ? new Date(value).toLocaleString('en-NG', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

type RpcClient = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

/** The support cases the signed-in CACU support person has opened (none for anyone else). The database decides who may
 * read what; this only lets the app offer the business in its switcher. */
export async function openedSupportCases(supabase: RpcClient): Promise<SupportCase[]> {
  try {
    const { data, error } = await supabase.rpc('support_cases');
    const cases = !error && data ? data as SupportCases : null;
    return cases?.staff && cases.two_step ? cases.cases.filter(c => c.opened) : [];
  } catch {
    return [];  // members' own businesses still load; support cases are offered again on the next load
  }
}
