
'use server';
/**
 * @fileOverview An AI flow for generating professional onboarding documents.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const OnboardingDocInputSchema = z.object({
  employeeName: z.string().describe('Full name of the new hire'),
  jobTitle: z.string().describe('Role of the new hire'),
  department: z.string().describe('Department assigned'),
  salary: z.number().describe('Agreed monthly salary'),
  startDate: z.string().describe('First day of work'),
  docType: z.enum(['Offer Letter', 'Employment Contract', 'Appointment Letter', 'Welcome Message']).describe('The type of document to generate'),
  businessName: z.string().default('CACU Technologies Limited'),
});
export type OnboardingDocInput = z.infer<typeof OnboardingDocInputSchema>;

const OnboardingDocOutputSchema = z.object({
  subject: z.string().describe('Professional subject line'),
  content: z.string().describe('The full body text of the document'),
});
export type OnboardingDocOutput = z.infer<typeof OnboardingDocOutputSchema>;

export async function generateOnboardingDocument(input: OnboardingDocInput): Promise<OnboardingDocOutput> {
  return onboardingDocFlow(input);
}

const prompt = ai.definePrompt({
  name: 'onboardingDocPrompt',
  input: { schema: OnboardingDocInputSchema },
  output: { schema: OnboardingDocOutputSchema },
  prompt: `You are the CACU AI HR Director, an expert in Nigerian labor practices and modern corporate communication.

Generate a professional {{docType}} for a new hire.

New Hire: {{employeeName}}
Role: {{jobTitle}}
Department: {{department}}
Salary: ₦{{salary}}
Start Date: {{startDate}}
Company: {{businessName}}

Guidelines:
- If "Offer Letter", be enthusiastic but formal, clearly state the role and remuneration.
- If "Employment Contract", use legally sound but readable language, mention standard Nigerian labor terms.
- If "Appointment Letter", confirm the final position and reporting line.
- If "Welcome Message", be warm, culture-focused, and welcoming.

Ensure the content is professional, comprehensive, and reflects the {{businessName}} brand.`,
});

const onboardingDocFlow = ai.defineFlow(
  {
    name: 'onboardingDocFlow',
    inputSchema: OnboardingDocInputSchema,
    outputSchema: OnboardingDocOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    return output!;
  }
);
