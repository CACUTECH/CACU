'use server';

import { AIAvailabilityService } from '@/services/ai-availability-service';

export interface InsightInput { context: string; userQuery?: string }
export interface InsightOutput { insight: string; suggestions: string[] }

// Kept for older clients; never forward browser context or questions to a provider.
export async function getBusinessInsight(_input: InsightInput): Promise<InsightOutput> {
  void _input; // Discard untrusted prototype payloads; no provider or persistence call.
  return new AIAvailabilityService().requireUnavailable('business');
}
