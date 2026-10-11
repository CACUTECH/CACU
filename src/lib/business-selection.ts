export const ACTIVE_BUSINESS_COOKIE = 'cacu-active-business';
export interface Membership { business_id: string; role: string }

export function selectMembership<T extends Membership>(memberships: T[], selected?: string): T | null {
  if (selected) {
    const member = memberships.find(m => m.business_id === selected);
    if (!member) throw new Error('Selected business membership is no longer valid');
    return member;
  }
  if (memberships.length > 1) throw new Error('Select an active business');
  return memberships[0] ?? null;
}