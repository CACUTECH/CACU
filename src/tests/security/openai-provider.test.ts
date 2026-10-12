import OpenAI from 'openai';
import { generateOpenAIText } from '@/ai/openai';
jest.mock('server-only', () => ({}), { virtual: true });
const mockCreate = jest.fn();
jest.mock('openai', () => ({ __esModule: true, default: jest.fn().mockImplementation(() => ({ responses: { create: (...args: unknown[]) => mockCreate(...args) } })) }));
const input = { instructions: 'Answer briefly using only approved information.', prompt: 'Synthetic connection test' };
const originalKey = process.env.OPENAI_API_KEY;
const originalModel = process.env.OPENAI_MODEL;
beforeEach(() => { jest.clearAllMocks(); mockCreate.mockReset(); process.env.OPENAI_API_KEY = 'test-only-key'; process.env.OPENAI_MODEL = 'test-approved-model'; });
afterAll(() => {
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
  if (originalModel === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = originalModel;
});
test('uses the OpenAI Responses API with explicit transport and storage limits', async () => {
  mockCreate.mockResolvedValue({ status: 'completed', output_text: ' Ready ' });
  await expect(generateOpenAIText(input)).resolves.toBe('Ready');
  expect(OpenAI).toHaveBeenCalledWith({ apiKey: 'test-only-key', baseURL: 'https://api.openai.com/v1', timeout: 20000, maxRetries: 0, logLevel: 'off' });
  expect(mockCreate).toHaveBeenCalledWith({ model: 'test-approved-model', instructions: input.instructions, input: input.prompt, store: false, max_output_tokens: 1000 });
});
test.each(['OPENAI_API_KEY', 'OPENAI_MODEL'])('missing %s cannot make a provider request', async name => {
  delete process.env[name]; await expect(generateOpenAIText(input)).rejects.toThrow('setup requires');
  expect(OpenAI).not.toHaveBeenCalled();
});
test('example placeholders cannot make a provider request', async () => {
  process.env.OPENAI_MODEL = 'replace-with-approved-model-id';
  await expect(generateOpenAIText(input)).rejects.toThrow('setup requires');
  expect(OpenAI).not.toHaveBeenCalled();
});
test('oversized input cannot incur a model request', async () => {
  await expect(generateOpenAIText({ ...input, prompt: 'x'.repeat(4001) })).rejects.toThrow('Invalid AI request');
  expect(OpenAI).not.toHaveBeenCalled();
});
test('provider errors never expose their body or secrets', async () => {
  mockCreate.mockRejectedValue(new Error('secret credential and private request'));
  await expect(generateOpenAIText(input)).rejects.toThrow('OpenAI request failed. Check project access, billing and model configuration.');
  expect(mockCreate).toHaveBeenCalledTimes(1);
});
test.each([{ status: 'incomplete', output_text: 'Partial answer' }, { status: 'completed', output_text: '' }, { status: 'completed', output_text: 'x'.repeat(8001) }])('does not treat partial/refused/oversized output as success', async response => {
  mockCreate.mockResolvedValue(response);
  await expect(generateOpenAIText(input)).rejects.toThrow('OpenAI request failed');
});
