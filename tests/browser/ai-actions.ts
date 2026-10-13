import type { AIChatRequest, AIChatResult } from '../../src/services/ai-chat-service';
declare global { interface Window { aiAttempts?: AIChatRequest[]; releaseAIAnswer?: () => void } }
export async function getAIChatStatusAction() { return { ready: true, message: 'General guidance only.' }; }
export async function askAIQuestionAction(input: AIChatRequest): Promise<AIChatResult> {
  const attempts = window.aiAttempts ??= [];
  attempts.push(structuredClone(input));
  if (input.question === 'Wait for old business') return new Promise(resolve => {
    window.releaseAIAnswer = () => resolve({ ok: true, answer: 'Old business answer' });
  });
  if (input.question === 'Interrupted question') {
    if (attempts.length === 1) throw new Error('Response interrupted');
    return { ok: false, code: 'duplicate', message: 'This question was already submitted. Start a new question only if you intend another request.' };
  }
  return { ok: true, answer: 'Review the recorded figures in your CACU reports. This is general guidance.' };
}
