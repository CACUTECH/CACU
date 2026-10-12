'use server';

import { AIAvailabilityService } from '@/services/ai-availability-service';

export interface LetterInput {
  employeeName: string; jobTitle: string; exitType: string;
  lastWorkingDay: string; reason: string; businessName?: string;
}
export interface LetterOutput { subject: string; content: string }

export async function generateHRLetter(_input: LetterInput): Promise<LetterOutput> {
  void _input; // Discard untrusted prototype payloads; no provider or persistence call.
  return new AIAvailabilityService().requireUnavailable('hr');
}
