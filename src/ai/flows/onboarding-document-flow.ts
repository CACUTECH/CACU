'use server';

import { AIAvailabilityService } from '@/services/ai-availability-service';

export interface OnboardingDocInput {
  employeeName: string; jobTitle: string; department: string; salary: number;
  startDate: string;
  docType: 'Offer Letter' | 'Employment Contract' | 'Appointment Letter' | 'Welcome Message';
  businessName?: string;
}
export interface OnboardingDocOutput { subject: string; content: string }

export async function generateOnboardingDocument(_input: OnboardingDocInput): Promise<OnboardingDocOutput> {
  void _input; // Discard untrusted prototype payloads; no provider or persistence call.
  return new AIAvailabilityService().requireUnavailable('hr');
}
