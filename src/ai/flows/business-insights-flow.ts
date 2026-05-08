'use server';
/**
 * @fileOverview A business insight AI agent for CACU.
 *
 * - getBusinessInsight - A function that handles generating business advice based on app context.
 * - InsightInput - The input type for the insight flow.
 * - InsightOutput - The return type for the insight flow.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const InsightInputSchema = z.object({
  context: z.string().describe('The context or page the user is currently on (e.g., Dashboard, Invoices).'),
  userQuery: z.string().optional().describe('An optional specific question or prompt from the user.'),
});
export type InsightInput = z.infer<typeof InsightInputSchema>;

const InsightOutputSchema = z.object({
  insight: z.string().describe('The AI-generated business insight or answer.'),
  suggestions: z.array(z.string()).describe('A list of 2-3 follow-up actions or questions.'),
});
export type InsightOutput = z.infer<typeof InsightOutputSchema>;

export async function getBusinessInsight(input: InsightInput): Promise<InsightOutput> {
  return businessInsightFlow(input);
}

const prompt = ai.definePrompt({
  name: 'businessInsightPrompt',
  input: { schema: InsightInputSchema },
  output: { schema: InsightOutputSchema },
  prompt: `You are the CACU AI Business Consultant, an expert advisor for small business owners in Nigeria. 
Your goal is to provide helpful, actionable, and encouraging business insights based on the user's current activity in the app.

Current App View: {{{context}}}
User's Question: {{{userQuery}}}

If the context is "Dashboard", focus on cash flow and performance trends.
If the context is "Inventory", focus on stock management and reorder optimization.
If the context is "Invoices", focus on receivable management and payment collections.

Always provide insights that are relevant to the Nigerian business landscape.
Keep your response concise (max 3 sentences) and provide relevant follow-up suggestions.`,
});

const businessInsightFlow = ai.defineFlow(
  {
    name: 'businessInsightFlow',
    inputSchema: InsightInputSchema,
    outputSchema: InsightOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    return output!;
  }
);
