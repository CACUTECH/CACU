'use server';
import { AIChatService, type AIChatRequest } from '@/services/ai-chat-service';
export async function getAIChatStatusAction(businessId: string) {
  return new AIChatService().status(businessId);
}
export async function askAIQuestionAction(input: AIChatRequest) {
  return new AIChatService().ask(input);
}
