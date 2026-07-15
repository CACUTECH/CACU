
'use server';
/**
 * @fileOverview An AI flow for generating professional HR exit/termination letters.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const LetterInputSchema = z.object({
  employeeName: z.string().describe('Full name of the employee'),
  jobTitle: z.string().describe('Role or title of the employee'),
  exitType: z.string().describe('Type of exit (Resignation, Termination, Retirement, etc.)'),
  lastWorkingDay: z.string().describe('The final date of employment'),
  reason: z.string().describe('The stated reason for the exit'),
  businessName: z.string().default('CACU Technologies Limited'),
});
export type LetterInput = z.infer<typeof LetterInputSchema>;

const LetterOutputSchema = z.object({
  subject: z.string().describe('Professional email/letter subject line'),
  content: z.string().describe('The full body text of the professional letter'),
});
export type LetterOutput = z.infer<typeof LetterOutputSchema>;

export async function generateHRLetter(input: LetterInput): Promise<LetterOutput> {
  return hrLetterFlow(input);
}

const prompt = ai.definePrompt({
  name: 'hrLetterPrompt',
  input: { schema: LetterInputSchema },
  output: { schema: LetterOutputSchema },
  prompt: `You are the CACU AI HR Director, an expert in Nigerian labor laws and professional corporate communication.

You need to draft a professional letter for an employee departure.

Employee: {{{employeeName}}}
Role: {{{jobTitle}}}
Exit Type: {{{exitType}}}
Last Day: {{{lastWorkingDay}}}
Reason: {{{reason}}}
Company: {{{businessName}}}

Guidelines:
- If it's a "Resignation Acceptance", be professional, appreciative, and wish them well.
- If it's a "Termination", be firm, objective, and follow standard professional protocols. Mention final settlement and asset return.
- If it's "Retirement", be warm, congratulatory, and celebrate their contribution.
- If it's "Service Certificate", summarize their time and impact at the company.

Ensure the language is clear, professional, and compliant with standard HR best practices.`,
});

const hrLetterFlow = ai.defineFlow(
  {
    name: 'hrLetterFlow',
    inputSchema: LetterInputSchema,
    outputSchema: LetterOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    return output!;
  }
);
