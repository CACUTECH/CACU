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

export type OpenAITool = { name: string; description: string; parameters: Record<string, unknown> };
export type OpenAIToolRun = { text: string; inputTokens: number; outputTokens: number; calls: { name: string; result: unknown }[] };

/** The books gateway's model loop (Doc 15). The model may only ask for the tools given; `run` executes each one for the
 *  caller, who enforces identity, permissions and limits. Bounded rounds and calls; nothing stored with the provider. */
export async function runOpenAITools(input: { instructions: string; question: string; tools: OpenAITool[];
  run: (name: string, args: unknown) => Promise<unknown>; maxRounds?: number; maxCalls?: number }): Promise<OpenAIToolRun> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim();
  if (!apiKey || !model || apiKey.startsWith('replace-') || model.startsWith('replace-')) {
    throw new Error('OpenAI setup requires OPENAI_API_KEY and OPENAI_MODEL.');
  }
  if (!input.question.trim() || input.question.length > 4000 || !input.instructions.trim() || input.instructions.length > 6000 || input.tools.length > 12) {
    throw new Error('Invalid AI request.');
  }
  const maxRounds = input.maxRounds ?? 4, maxCalls = input.maxCalls ?? 8;
  const names = new Set(input.tools.map(t => t.name));
  const tools: OpenAI.Responses.FunctionTool[] = input.tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: false }));
  const items: OpenAI.Responses.ResponseInputItem[] = [{ role: 'user', content: input.question }];
  const calls: OpenAIToolRun['calls'] = [];
  let inputTokens = 0, outputTokens = 0;
  try {
    const client = new OpenAI({ apiKey, baseURL: 'https://api.openai.com/v1', timeout: 20_000, maxRetries: 0, logLevel: 'off' });
    for (let round = 0; round < maxRounds; round++) {
      const last = round === maxRounds - 1;
      const response = await client.responses.create({ model, instructions: input.instructions, input: items, tools,
        tool_choice: last ? 'none' : 'auto', store: false, max_output_tokens: 1000 });
      inputTokens += response.usage?.input_tokens ?? 0; outputTokens += response.usage?.output_tokens ?? 0;
      const asked = response.output.filter((o): o is OpenAI.Responses.ResponseFunctionToolCall => o.type === 'function_call');
      if (!asked.length) {
        if (response.status !== 'completed' || !response.output_text?.trim() || response.output_text.length > 8000) throw new Error('Invalid response');
        return { text: response.output_text.trim(), inputTokens, outputTokens, calls };
      }
      for (const call of asked) {
        items.push({ type: 'function_call', call_id: call.call_id, name: call.name, arguments: call.arguments });
        let result: unknown;
        if (!names.has(call.name)) result = { error: 'There is no such tool.' };
        else if (calls.length >= maxCalls) result = { error: 'Too many lookups for one question. Answer with what you have.' };
        else {
          let args: unknown = null;
          try { args = JSON.parse(call.arguments || '{}'); } catch { args = null; }
          result = args && typeof args === 'object' && !Array.isArray(args) ? await input.run(call.name, args) : { error: 'The tool input was not valid.' };
          calls.push({ name: call.name, result });
        }
        const output = JSON.stringify(result);
        items.push({ type: 'function_call_output', call_id: call.call_id, output: output.length > 16000 ? JSON.stringify({ error: 'The result was too large.' }) : output });
      }
    }
    throw new Error('No answer');
  } catch {
    // Never return provider error bodies, credentials or raw prompts to clients/logs.
    throw new Error('OpenAI request failed. Check project access, billing and model configuration.');
  }
}
