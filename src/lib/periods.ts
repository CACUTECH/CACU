// Month close (Doc 09 checklist, FR-135; E14 R3 part 1): what the accounting API returns for the periods screen.
export type CloseStep = { key: string; label: string; blocking: boolean; passed: boolean; detail: string | null; needs_answer: boolean };
export type PeriodMonth = { month: string; status: 'open' | 'closed' | 'reopened'; closed_at: string | null };
export type PeriodHistory = { event: 'period_closed' | 'period_reopened'; month: string; reason: string | null; at: string };
export type PeriodOverview = { months: PeriodMonth[]; next_to_close: string | null; latest_closed: string | null; checklist: CloseStep[]; history: PeriodHistory[] };
export type Answer = { done: boolean; note: string };

export const monthName = (month: string) => new Date(`${month}T12:00:00`).toLocaleDateString('en-NG', { month: 'long', year: 'numeric' });
export const monthKey = (month: string) => month.slice(0, 7);

/** The warnings the closer still has to tick or explain (at least 5 characters), before the API is asked. */
export function unanswered(steps: CloseStep[], answers: Record<string, Answer>): CloseStep[] {
  return steps.filter(s => s.needs_answer && !(answers[s.key]?.done || (answers[s.key]?.note ?? '').trim().length >= 5));
}
