type SetupInput = { requestKey?: string; name: string; account_number: string };
declare global { interface Window { setupAttempts?: SetupInput[]; setupRoute?: string } }
export async function createBusinessAction(input: SetupInput) {
  const attempts = window.setupAttempts ??= [];
  attempts.push(structuredClone(input));
  if (attempts.length === 1) throw new Error('Response unavailable. Retry the same request.');
  if (attempts.length === 2) return { success: true, businessId: 'business', selectionPending: true };
  return { success: true, businessId: 'business' };
}
