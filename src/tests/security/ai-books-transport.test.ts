import { runOpenAITools } from '@/ai/openai';
jest.mock('server-only', () => ({}), { virtual: true });
const mockCreate = jest.fn();
jest.mock('openai', () => ({ __esModule: true, default: jest.fn().mockImplementation(() => ({ responses: { create: (...args: unknown[]) => mockCreate(...args) } })) }));

const tools = [{ name: 'profit_summary', description: 'Profit', parameters: { type: 'object' } }];
const call = (name: string, args = '{"start_date":"2026-11-01","end_date":"2026-11-18"}', id = 'c1') =>
  ({ status: 'completed', output_text: '', usage: { input_tokens: 100, output_tokens: 10 }, output: [{ type: 'function_call', call_id: id, name, arguments: args }] });
const done = (text: string) => ({ status: 'completed', output_text: text, usage: { input_tokens: 200, output_tokens: 30 }, output: [{ type: 'message' }] });
const original = { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL };
beforeEach(() => { mockCreate.mockReset(); process.env.OPENAI_API_KEY = 'test-only-key'; process.env.OPENAI_MODEL = 'test-approved-model'; });
afterAll(() => { for (const [k, v] of [['OPENAI_API_KEY', original.key], ['OPENAI_MODEL', original.model]]) { if (v === undefined) delete process.env[k!]; else process.env[k!] = v; } });

test('runs the tools the model asks for, feeds results back, and stores nothing with the provider', async () => {
  mockCreate.mockResolvedValueOnce(call('profit_summary')).mockResolvedValueOnce(done('Profit was ₦15,599.00.'));
  const run = jest.fn().mockResolvedValue({ data: { net: '15599.00' } });
  const out = await runOpenAITools({ instructions: 'Rules', question: 'Profit?', tools, run });
  expect(out).toEqual({ text: 'Profit was ₦15,599.00.', inputTokens: 300, outputTokens: 40, calls: [{ name: 'profit_summary', result: { data: { net: '15599.00' } } }] });
  expect(run).toHaveBeenCalledWith('profit_summary', { start_date: '2026-11-01', end_date: '2026-11-18' });
  const second = mockCreate.mock.calls[1][0];
  expect(second).toEqual(expect.objectContaining({ store: false, max_output_tokens: 1000, tool_choice: 'auto' }));
  expect(second.tools).toEqual([{ type: 'function', name: 'profit_summary', description: 'Profit', parameters: { type: 'object' }, strict: false }]);
  expect(second.input).toContainEqual({ type: 'function_call_output', call_id: 'c1', output: '{"data":{"net":"15599.00"}}' });
});

test('a tool the model was not given, or bad arguments, never run', async () => {
  mockCreate.mockResolvedValueOnce(call('post_journal')).mockResolvedValueOnce(call('profit_summary', 'not json', 'c2')).mockResolvedValueOnce(done('Sorry.'));
  const run = jest.fn();
  await runOpenAITools({ instructions: 'Rules', question: 'Post it', tools, run });
  expect(run).not.toHaveBeenCalled();
  const output = (id: string) => mockCreate.mock.calls[2][0].input.find((i: { type: string; call_id?: string }) => i.type === 'function_call_output' && i.call_id === id).output;
  expect(output('c1')).toBe('{"error":"There is no such tool."}');
  expect(output('c2')).toBe('{"error":"The tool input was not valid."}');
});

test('rounds and lookups are bounded, and the last round must answer', async () => {
  mockCreate.mockResolvedValue(call('profit_summary'));
  const run = jest.fn().mockResolvedValue({});
  await expect(runOpenAITools({ instructions: 'Rules', question: 'Loop', tools, run, maxRounds: 3, maxCalls: 1 })).rejects.toThrow('OpenAI request failed');
  expect(mockCreate).toHaveBeenCalledTimes(3);
  expect(mockCreate.mock.calls[2][0].tool_choice).toBe('none');
  expect(run).toHaveBeenCalledTimes(1);
});

test('provider errors and missing setup expose nothing', async () => {
  mockCreate.mockRejectedValue(new Error('secret body'));
  await expect(runOpenAITools({ instructions: 'Rules', question: 'Q', tools, run: jest.fn() })).rejects.toThrow('OpenAI request failed. Check project access, billing and model configuration.');
  delete process.env.OPENAI_MODEL;
  mockCreate.mockClear();
  await expect(runOpenAITools({ instructions: 'Rules', question: 'Q', tools, run: jest.fn() })).rejects.toThrow('setup requires');
  expect(mockCreate).not.toHaveBeenCalled();
});
