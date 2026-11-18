// Stock counts (E09 R3): what the accounting API returns for a count.
export type CountLine = { item_id: string; name: string; expected: number; counted: number | null; difference: number | null; posted: boolean };
export type StockCount = { id: string; name: string; status: 'counting' | 'submitted' | 'approved' | 'rejected'; location_id: string | null; outlet: string | null;
  started_at: string; submitted_at: string | null; submitted_by: string | null; decided_on: string | null; note: string | null; lines?: CountLine[];
  summary: { items: number; counted: number; differences: number } };
export const STATUS: Record<StockCount['status'], string> = { counting: 'Counting', submitted: 'Waiting for approval', approved: 'Approved', rejected: 'Rejected' };
/** What a typed quantity means: blank is "not counted", otherwise a whole number of zero or more. */
export function quantity(value: string): number | null | undefined {
  const text = value.trim();
  if (!text) return null;
  return /^\d{1,8}$/.test(text) ? Number(text) : undefined;
}
