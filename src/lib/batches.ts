// Batches and expiry dates (E09 R3): what the accounting API returns for the batches screen.
export type Batch = { id: string; batch_no: string | null; expiry: string | null; quantity: number; received_on: string | null;
  state: 'ok' | 'soon' | 'expired' | 'unknown'; days_left: number | null };
export type BatchItem = { id: string; name: string; stock: number; tracked: boolean; batches: Batch[] };
export type Batches = { items: BatchItem[]; attention: (Batch & { item: string })[]; soon_days: number };
export const STATE_LABEL: Record<Batch['state'], string> = { ok: 'In date', soon: 'Expires soon', expired: 'Expired', unknown: 'No expiry recorded' };
/** "Expires in 12 days", "Expired 3 days ago", "Expires today". */
export function whenExpires(b: Batch): string {
  if (b.days_left == null) return 'No expiry recorded';
  if (b.days_left === 0) return 'Expires today';
  return b.days_left > 0 ? `Expires in ${b.days_left} day${b.days_left === 1 ? '' : 's'}` : `Expired ${-b.days_left} day${b.days_left === -1 ? '' : 's'} ago`;
}
