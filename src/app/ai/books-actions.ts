'use server';
// AI on the books (Doc 15; E18 R3). Off until CACU switches it on after gate G4 and the owner switches it on for the business.
import { AIBooksService, type AIBooksRequest } from '@/services/ai-books-service';

export async function getAIBooksStatusAction(businessId: string) {
  return new AIBooksService().status(businessId);
}
export async function setAIBooksAction(businessId: string, enabled: boolean) {
  return new AIBooksService().setEnabled(businessId, enabled);
}
export async function askAIBooksAction(input: AIBooksRequest) {
  return new AIBooksService().ask(input);
}
