import { AIChatService } from '@/services/ai-chat-service';
import { generateOpenAIText } from '@/ai/openai';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
jest.mock('@/ai/openai', () => ({ generateOpenAIText: jest.fn() }));
jest.mock('@/lib/logger', () => ({ logger: { security: jest.fn(), perf: jest.fn() } }));
const businessId = '11111111-1111-4111-8111-111111111111';
const input = { businessId, requestKey: '33333333-3333-4333-8333-333333333333', question: 'How should I review my cash flow?' };
const original = { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL, enabled: process.env.CACU_AI_ENABLED };
function query(data: unknown, error: unknown = null) {
  return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data, error }) };
}
async function prepare(role = 'owner') {
  const client = await (createClient as jest.Mock)();
  client.from.mockReturnValueOnce(query({ business_id: businessId, role }))
    .mockReturnValueOnce(query({ business_type: 'SERVICE' }))
    .mockReturnValueOnce(query({ business_id: businessId, role }));
  client.rpc.mockImplementation(async (name: string) => ({ data: name === 'reserve_ai_chat' ? { reserved: true, status: 'reserved' } : true, error: null }));
  return client;
}
beforeEach(async () => {
  jest.clearAllMocks();
  (generateOpenAIText as jest.Mock).mockReset().mockResolvedValue('Review the recorded figures in CACU reports.');
  process.env.OPENAI_API_KEY = 'test-only-key'; process.env.OPENAI_MODEL = 'test-model'; process.env.CACU_AI_ENABLED = 'true';
  const client = await (createClient as jest.Mock)(); client.rpc.mockReset(); client.from.mockReset();
  (await cookies()).get = jest.fn().mockReturnValue({ value: businessId });
});
afterAll(() => {
  for (const [name, value] of [['OPENAI_API_KEY',original.key],['OPENAI_MODEL',original.model],['CACU_AI_ENABLED',original.enabled]]) {
    if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
  }
});
test.each(['owner','admin','editor','viewer'])('%s general guidance uses only verified business type, bounded question and no records', async role => {
  const client = await prepare(role);
  const result = await new AIChatService().ask(input);
  expect(result.ok).toBe(true);
  expect(client.from).toHaveBeenCalledTimes(3);
  expect(client.from).toHaveBeenCalledWith('businesses');
  expect(generateOpenAIText).toHaveBeenCalledWith({ instructions: expect.stringContaining('Verified business type: SERVICE'), prompt: input.question });
  expect(client.rpc).toHaveBeenNthCalledWith(1, 'reserve_ai_chat', expect.objectContaining({ p_business_id: businessId, p_request_key: input.requestKey, p_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) }));
  expect(client.rpc).toHaveBeenNthCalledWith(2, 'finish_ai_chat', { p_business_id: businessId, p_request_key: input.requestKey, p_status: 'completed' });
  expect(JSON.stringify(client.rpc.mock.calls)).not.toContain(input.question);
});
test('unauthenticated direct calls never initialize a model request', async () => {
  const client = await (createClient as jest.Mock)();
  client.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
  expect(await new AIChatService().ask(input)).toEqual(expect.objectContaining({ ok: false, code: 'access_denied' }));
  expect(client.from).not.toHaveBeenCalled(); expect(generateOpenAIText).not.toHaveBeenCalled();
});
test('client-selected foreign business is rejected against the current server selection', async () => {
  const client = await (createClient as jest.Mock)();
  client.from.mockReturnValueOnce(query({ business_id: businessId, role: 'owner' }));
  const result = await new AIChatService().ask({ ...input, businessId: '22222222-2222-4222-8222-222222222222' });
  expect(result).toEqual(expect.objectContaining({ ok: false, code: 'access_denied' }));
  expect(client.rpc).not.toHaveBeenCalled(); expect(generateOpenAIText).not.toHaveBeenCalled();
});
test.each(['OPENAI_API_KEY','OPENAI_MODEL','CACU_AI_ENABLED'])('missing %s fails before reservation or provider use', async variable => {
  const client = await prepare(); delete process.env[variable];
  expect(await new AIChatService().ask(input)).toEqual(expect.objectContaining({ ok: false, code: 'unavailable' }));
  expect(client.rpc).not.toHaveBeenCalled(); expect(generateOpenAIText).not.toHaveBeenCalled();
});
test('oversized and extra client context fail before any source projection', async () => {
  const client = await (createClient as jest.Mock)();
  client.from.mockReturnValue(query({ business_id: businessId, role: 'owner' }));
  for (const request of [{ ...input, question: 'x'.repeat(2001) }, { ...input, financials: 'forged figures' }]) {
    expect(await new AIChatService().ask(request)).toEqual(expect.objectContaining({ ok: false, code: 'invalid' }));
  }
  expect(client.from).not.toHaveBeenCalledWith('businesses'); expect(generateOpenAIText).not.toHaveBeenCalled();
});
test.each([
  { message: 'AI_RATE_LIMIT', code: 'rate_limit' }, { message: 'AI_DISABLED', code: 'unavailable' },
  { message: 'private internal error', code: 'failed' },
])('reservation errors cannot incur a provider call', async ({ message, code }) => {
  const client = await prepare(); client.rpc.mockResolvedValueOnce({ data: null, error: { message } });
  expect(await new AIChatService().ask(input)).toEqual(expect.objectContaining({ ok: false, code }));
  expect(generateOpenAIText).not.toHaveBeenCalled();
});
test('duplicate key never repeats the model request', async () => {
  const client = await prepare(); client.rpc.mockResolvedValueOnce({ data: { reserved: false, status: 'completed' }, error: null });
  expect(await new AIChatService().ask(input)).toEqual(expect.objectContaining({ ok: false, code: 'duplicate' }));
  expect(generateOpenAIText).not.toHaveBeenCalled();
});
test('unknown reservation response fails closed', async () => {
  const client = await prepare(); client.rpc.mockResolvedValueOnce({ data: {}, error: null });
  expect(await new AIChatService().ask(input)).toEqual(expect.objectContaining({ ok: false, code: 'failed' }));
  expect(generateOpenAIText).not.toHaveBeenCalled();
});
test('provider failure leaves the reservation charged and records no prompt', async () => {
  const client = await prepare(); (generateOpenAIText as jest.Mock).mockRejectedValueOnce(new Error('Private key and prompt'));
  const result = await new AIChatService().ask(input);
  expect(result).toEqual(expect.objectContaining({ ok: false, code: 'failed' }));
  expect(JSON.stringify(result)).not.toContain('Private key');
  expect(client.rpc).toHaveBeenLastCalledWith('finish_ai_chat', expect.objectContaining({ p_status: 'failed' }));
});
test('revocation during provider request suppresses the generated answer', async () => {
  const client = await (createClient as jest.Mock)();
  client.from.mockReturnValueOnce(query({ business_id: businessId, role: 'owner' }))
    .mockReturnValueOnce(query({ business_type: 'PRODUCT' })).mockReturnValueOnce(query(null));
  client.rpc.mockResolvedValue({ data: { reserved: true }, error: null });
  const result = await new AIChatService().ask(input);
  expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain('Review the recorded figures');
});
test('completion outage suppresses the answer rather than treating unconfirmed state as success', async () => {
  const client = await prepare();
  client.rpc.mockResolvedValueOnce({ data: { reserved: true }, error: null })
    .mockResolvedValueOnce({ data: null, error: { message: 'Network failure' } });
  expect(await new AIChatService().ask(input)).toEqual(expect.objectContaining({ ok: false, code: 'failed' }));
});

test('identity change during provider I/O suppresses the previous user response', async () => {
  const client = await prepare();
  client.auth.getUser.mockResolvedValueOnce({ data: { user: { id: 'first-user' } }, error: null })
    .mockResolvedValueOnce({ data: { user: { id: 'second-user' } }, error: null });
  expect(await new AIChatService().ask(input)).toEqual(expect.objectContaining({ ok: false, code: 'failed' }));
});
test('missing database migration prevents availability from being advertised', async () => {
  const client = await (createClient as jest.Mock)();
  client.from.mockReturnValueOnce(query({ business_id: businessId, role: 'owner' }));
  client.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Function missing' } });
  expect((await new AIChatService().status(businessId)).ready).toBe(false);
  expect(generateOpenAIText).not.toHaveBeenCalled();
});
