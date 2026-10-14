export async function readLedgerPageAction(page = 0) {
  const response = await fetch('/test/ledger?page=' + page);
  if (!response.ok) throw new Error('Ledger unavailable');
  return response.json();
}
export async function recordLedgerEntryAction() { return { success: false, error: 'Posting is not enabled in this read test' }; }
