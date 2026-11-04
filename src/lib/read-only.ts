// A suspended, cancelled or closed subscription makes the workspace read-only (Doc 14 SUB-10). The database refuses
// new trading with SUBSCRIPTION_READ_ONLY; every service shows the same plain sentence for it.
export const READ_ONLY_MESSAGE = 'Your workspace is read-only until the subscription is paid. You can still record payments received and export.';

export function isReadOnlyRefusal(error: { message?: string | null } | null | undefined) {
  return Boolean(error?.message?.includes('SUBSCRIPTION_READ_ONLY'));
}
