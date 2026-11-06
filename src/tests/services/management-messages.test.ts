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
    ['SUBSCRIPTION_READ_ONLY', 'Your workspace is read-only until the subscription is paid. You can still record payments received and export.'],
    ['PLAN_LIMIT users.max', 'Your plan has no free user seats. Open invitations hold a seat too. Cancel one, deactivate someone, or upgrade in Billing.'],
])('%s is shown in plain words and known not to have been saved', async (code, message) => {
    client.rpc.mockResolvedValueOnce({ data: null, error: { message: code, code: 'P0001' } });
    const failure = await invite().catch(e => e);
    expect(failure).toBeInstanceOf(ManagementWriteError);
    expect(failure.message).toBe(message);
    expect(failure.uncertain).toBe(false);
});

test('a missing permission reads in plain words whatever permission it names', async () => {
    client.rpc.mockResolvedValueOnce({ data: null, error: { message: 'PERMISSION_DENIED settings.create', code: '42501' } });
    const failure = await invite().catch(e => e);
    expect(failure.message).toBe('You do not have permission to do this in this business. Ask the business owner.');
    expect(failure.uncertain).toBe(false);
});

test('unknown refusals keep their original text', async () => {
    client.rpc.mockResolvedValueOnce({ data: null, error: { message: 'VERSION_CONFLICT', code: 'P0001' } });
    await expect(invite()).rejects.toThrow('VERSION_CONFLICT');
});

test('an invitation with a template goes through invite_member with the same request key', async () => {
    client.rpc.mockResolvedValueOnce({ data: { id: 'I', role: 'editor' }, error: null });
    await service.write({ request_key: key, operation: 'invitation.create', details: { email: 'a@example.com', template_id: 'T' } });
    expect(client.rpc).toHaveBeenCalledWith('invite_member', { p_business_id: 'B', p_request_key: key, p_data: { email: 'a@example.com', template_id: 'T' } });
});

test.each([
    ['TEMPLATE_EXCEEDS_YOUR_ACCESS', 'You can only give someone access you have yourself. Ask the business owner.'],
    ['TEMPLATE_IN_USE', 'Move everyone off this profile, and cancel invitations that use it, before deleting it.'],
    ['PLAN_LIMIT module.custom_roles', 'Custom profiles are on the Oga and Chairman plans. Upgrade in Billing to create one.'],
    ['PERMISSION_DENIED settings.edit', 'You do not have permission to do this in this business. Ask the business owner.'],
    ['SOMETHING_ELSE', 'That change was not saved. Refresh and try again.'],
])('template change refusal %s reads in plain words', async (code, message) => {
    client.rpc.mockResolvedValueOnce({ data: null, error: { message: code, code: '42501' } });
    await expect(service.assignTemplate('U', 'T')).rejects.toThrow(message);
});
