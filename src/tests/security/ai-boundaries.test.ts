import { getBusinessInsight } from '@/ai/flows/business-insights-flow';
import { generateOnboardingDocument } from '@/ai/flows/onboarding-document-flow';
import { generateHRLetter } from '@/ai/flows/termination-letter-flow';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { AI_UNAVAILABLE_MESSAGE } from '@/lib/ai-availability';

// Loading provider infrastructure from these retired actions is itself a regression.
jest.mock('@/ai/genkit', () => { throw new Error('Retired actions must not initialize a provider'); });
jest.mock('@/lib/logger', () => ({ logger: { security: jest.fn(), perf: jest.fn() } }));
const actions = [
  { name: 'insights', run: () => getBusinessInsight({ context: 'Private page data', userQuery: 'Forged Enterprise tier' }) },
  { name: 'onboarding', run: () => generateOnboardingDocument({ employeeName: 'Private employee', jobTitle: 'Role', department: 'Team', salary: 10000, startDate: '2026-10-12', docType: 'Offer Letter' }) },
  { name: 'departure', run: () => generateHRLetter({ employeeName: 'Private employee', jobTitle: 'Role', exitType: 'Termination', lastWorkingDay: '2026-10-12', reason: 'Private reason' }) },
];
function query(data: unknown, error: unknown = null) {
  return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data, error }), limit: jest.fn().mockResolvedValue({ data, error }) };
}
beforeEach(async () => {
  jest.clearAllMocks();
  (await cookies()).get = jest.fn().mockReturnValue({ value: 'selected-business' });
});

describe.each(actions)('$name direct action', ({ run }) => {
  test('rejects missing identity before any membership lookup', async () => {
    const client = await (createClient as jest.Mock)();
    client.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(run()).rejects.toThrow('Authentication required');
    expect(client.from).not.toHaveBeenCalled();
  });
  test('rejects an authentication error even when user data exists', async () => {
    const client = await (createClient as jest.Mock)();
    client.auth.getUser.mockResolvedValueOnce({ data: { user: { id: 'test-user-id' } }, error: { message: 'Expired' } });
    await expect(run()).rejects.toThrow('Authentication required');
    expect(client.from).not.toHaveBeenCalled();
  });
  test('rejects revoked or foreign selected membership', async () => {
    const client = await (createClient as jest.Mock)();
    const membership = query(null);
    client.from.mockReturnValueOnce(membership);
    await expect(run()).rejects.toThrow('no longer valid');
    expect(membership.eq).toHaveBeenCalledWith('user_id', 'test-user-id');
    expect(membership.eq).toHaveBeenCalledWith('business_id', 'selected-business');
  });
  test('fails closed on membership lookup errors', async () => {
    const client = await (createClient as jest.Mock)();
    client.from.mockReturnValueOnce(query(null, { message: 'Private database error' }));
    await expect(run()).rejects.toThrow('no longer valid');
  });
  test('does not pick the first business when selection is ambiguous', async () => {
    (await cookies()).get = jest.fn().mockReturnValue(undefined);
    const client = await (createClient as jest.Mock)();
    client.from.mockReturnValueOnce(query([{ business_id: 'A', role: 'owner' }, { business_id: 'B', role: 'owner' }]));
    await expect(run()).rejects.toThrow('Select an active business');
  });
  test('requires membership even without an active selection', async () => {
    (await cookies()).get = jest.fn().mockReturnValue(undefined);
    const client = await (createClient as jest.Mock)();
    client.from.mockReturnValueOnce(query([]));
    await expect(run()).rejects.toThrow('Business context required');
  });
  test.each(['owner', 'admin'])('%s receives unavailable without invoking a provider', async role => {
    const client = await (createClient as jest.Mock)();
    client.from.mockReturnValueOnce(query({ business_id: 'selected-business', role }));
    await expect(run()).rejects.toThrow(AI_UNAVAILABLE_MESSAGE);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).toHaveBeenCalledTimes(1);
  });
  test('unknown role cannot gain access from user-editable claims', async () => {
    const client = await (createClient as jest.Mock)();
    client.auth.getUser.mockResolvedValueOnce({ data: { user: { id: 'test-user-id', user_metadata: { role: 'owner', tier: 'Enterprise' } } }, error: null });
    client.from.mockReturnValueOnce(query({ business_id: 'selected-business', role: 'guest' }));
    await expect(run()).rejects.toThrow('Insufficient permissions');
  });
});
test.each(['editor', 'viewer'])('HR actions deny %s while general insights remain unavailable', async role => {
  const client = await (createClient as jest.Mock)();
  for (const { name, run } of actions) {
    client.from.mockReturnValueOnce(query({ business_id: 'selected-business', role }));
    await expect(run()).rejects.toThrow(name === 'insights' ? AI_UNAVAILABLE_MESSAGE : 'Insufficient permissions');
  }
});
