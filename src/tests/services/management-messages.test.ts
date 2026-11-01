import { ManagementService, ManagementWriteError } from '@/services/management-service';
import { createClient } from '@/lib/supabase/server';
jest.mock('@/lib/accounting-client', () => ({ usesPythonAccounting: jest.fn().mockResolvedValue(false), accountingRequest: jest.fn() }));
const key = '11111111-1111-4111-8111-111111111111';
let service: ManagementService, client: { rpc: jest.Mock };
beforeEach(async () => {
    jest.clearAllMocks(); service = new ManagementService(); client = await (createClient as jest.Mock)();
    (service as unknown as { getContext: jest.Mock }).getContext = jest.fn().mockResolvedValue({ supabase: client, businessId: 'B', role: 'owner' });
});
const invite = () => service.write({ request_key: key, operation: 'invitation.create', details: { email: 'a@example.com', role: 'viewer' } });

test.each([
    ['INVITATION_LIMIT_REACHED', 'Too many invitations sent recently. Try again in an hour.'],
    ['PLEASE_WAIT_BEFORE_RESENDING', 'This invitation was just sent. Wait a minute before resending it.'],
    ['MEMBER_ALREADY_EXISTS', 'That person is already a member of this business.'],
])('%s is shown in plain words and known not to have been saved', async (code, message) => {
    client.rpc.mockResolvedValueOnce({ data: null, error: { message: code, code: 'P0001' } });
    const failure = await invite().catch(e => e);
    expect(failure).toBeInstanceOf(ManagementWriteError);
    expect(failure.message).toBe(message);
    expect(failure.uncertain).toBe(false);
});

test('unknown refusals keep their original text', async () => {
    client.rpc.mockResolvedValueOnce({ data: null, error: { message: 'VERSION_CONFLICT', code: 'P0001' } });
    await expect(invite()).rejects.toThrow('VERSION_CONFLICT');
});
