import { selectMembership } from '@/lib/business-selection';

const a = { business_id: 'A', role: 'owner' };
const b = { business_id: 'B', role: 'viewer' };

test('requires explicit selection for multiple memberships', () => {
  expect(() => selectMembership([a, b])).toThrow('Select an active business');
  expect(selectMembership([a, b], 'B')).toBe(b);
});
test('rejects stale and hostile selections', () => {
  expect(() => selectMembership([a], 'B')).toThrow('no longer valid');
  expect(() => selectMembership([], 'A')).toThrow('no longer valid');
});
test('keeps single-business onboarding compatible', () => {
  expect(selectMembership([a])).toBe(a);
  expect(selectMembership([])).toBeNull();
});