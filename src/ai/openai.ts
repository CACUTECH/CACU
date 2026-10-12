import 'server-only';
import OpenAI from 'openai';

/** Server transport only. Callers must enforce identity, permissions and usage limits. */
export async function generateOpenAIText(input: { instructions: string; prompt: string }): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim();
  if (!apiKey || !model || apiKey.startsWith('replace-') || model.startsWith('replace-')) {
    throw new Error('OpenAI setup requires OPENAI_API_KEY and OPENAI_MODEL.');
  }
  if (typeof input?.prompt !== 'string' || typeof input?.instructions !== 'string'
    || !input.prompt.trim() || !input.instructions.trim()
    || input.prompt.length > 4000 || input.instructions.length > 4000) {
    throw new Error('Invalid AI request.');
  }
  try {
    const client = new OpenAI({ apiKey, baseURL: 'https://api.openai.com/v1',
      timeout: 20_000, maxRetries: 0, logLevel: 'off' });
    const response = await client.responses.create({ model, instructions: input.instructions,
      input: input.prompt, store: false, max_output_tokens: 1000 });
    if (response.status !== 'completed' || !response.output_text?.trim()
      || response.output_text.length > 8000) throw new Error('Invalid response');
    return response.output_text.trim();
  } catch {
    // Never return provider error bodies, credentials or raw prompts to clients/logs.
    throw new Error('OpenAI request failed. Check project access, billing and model configuration.');
  }
}
