import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BaseService } from './base-service';
import type { OpenAITool } from '@/ai/openai';
import { accountingRequest } from '@/lib/accounting-client';
import { AI_NOT_ON_PLAN, AI_SUSPENDED, allowanceLine, limitReachedLine } from '@/lib/ai-quota';
import { inert, NOT_HELPFUL_REASONS, type BooksAnswer } from '@/lib/ai-books';
import { answerFromBooks, type BooksTrace } from '@/lib/ai-books-answer';

export { instructions } from '@/lib/ai-books-answer';

// The AI gateway for questions about the business's own books (Doc 15 "AI query and response architecture").
// It is the only place the model is called with business figures. It offers the model only the tools this member may
// use, runs them through the accounting API with the member's own session (permissions apply as on the screens),
// checks the answer's figures against the tool results (AI-001) and returns the sources and limitations itself, so the
// screen shows them whatever the model wrote (AI-002, AI-003). Questions and answers are never stored (AI-009).

const requestSchema = z.object({ businessId: z.string().uuid(), requestKey: z.string().uuid(),
  question: z.string().trim().min(1).max(2000) }).strict();
export type AIBooksRequest = z.infer<typeof requestSchema>;
const feedbackSchema = z.object({ businessId: z.string().uuid(), requestKey: z.string().uuid(),
  reason: z.enum(NOT_HELPFUL_REASONS.map(r => r.code) as [string, ...string[]]) }).strict();
export type AIBooksFeedback = z.infer<typeof feedbackSchema>;
export type AIBooksResult = ({ ok: true; allowance?: string | null } & BooksAnswer) | { ok: false;
  code: 'unavailable' | 'rate_limit' | 'plan_limit' | 'duplicate' | 'invalid' | 'failed' | 'access_denied'; message: string };
export type AIBooksStatus = { ready: boolean; available: boolean; on: boolean; mayChange: boolean; paused: boolean; message: string; allowance?: string | null };

export const AI_BOOKS_OFF = 'Answers from your books are not switched on for this business.';
export const AI_BOOKS_UNAVAILABLE = 'Answers from your books are not available yet.';
const validRoles = ['owner', 'admin', 'editor', 'viewer'];
function configuredModel() {
  const key = process.env.OPENAI_API_KEY?.trim(); const model = process.env.OPENAI_MODEL?.trim();
  return process.env.CACU_AI_ENABLED === 'true' && process.env.CACU_AI_BOOKS_ENABLED === 'true' && key && model
    && !key.startsWith('replace-') && !model.startsWith('replace-') ? model : null;
}

function lagosToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export class AIBooksService extends BaseService {
  private async context(expectedBusinessId: string) {
    const context = await this.getContext();
    if (!context.businessId || context.businessId !== expectedBusinessId
      || !context.role || !validRoles.includes(context.role)) throw new Error('AI_ACCESS_DENIED');
    return context;
  }
  private async allowance(supabase: Awaited<ReturnType<AIBooksService['context']>>['supabase'], businessId: string) {
    try { const { data, error } = await supabase.rpc('get_ai_chat_quota', { p_business_id: businessId }); return error ? null : data; }
    catch { return null; }
  }

  async status(businessId: string): Promise<AIBooksStatus> {
    const off = { ready: false, available: false, on: false, mayChange: false, paused: false };
    try {
      const { supabase } = await this.context(businessId);
      const { data, error } = await supabase.rpc('get_ai_books_status', { p_business_id: businessId });
      if (error || !data) return { ...off, message: AI_BOOKS_UNAVAILABLE };
      const state = { available: data.available === true && configuredModel() !== null, on: data.on === true, mayChange: data.may_change === true, paused: data.paused === true };
      if (!state.available) return { ...off, ...state, message: state.paused ? 'Answers from your books are paused while CACU checks usage. They will be switched back on after the check.' : AI_BOOKS_UNAVAILABLE };
      if (!state.on) return { ...off, ...state, message: AI_BOOKS_OFF };
      const allowance = allowanceLine(await this.allowance(supabase, businessId));
      if (allowance === AI_NOT_ON_PLAN) return { ...off, ...state, message: AI_NOT_ON_PLAN };
      return { ready: true, ...state, message: 'Answers come from your CACU books. Check the figures on the linked screens.', allowance };
    } catch { return { ...off, message: 'Select a business you can access before using the assistant.' }; }
  }

  /** AI-012: the owner switches answers from the books on or off for the business. */
  async setEnabled(businessId: string, enabled: boolean): Promise<{ ok: boolean; message?: string }> {
    try {
      const { supabase } = await this.context(businessId);
      const { error } = await supabase.rpc('set_ai_books', { p_business_id: businessId, p_enabled: enabled === true });
      if (error) return { ok: false, message: error.message === 'AI_OWNER_ONLY' ? 'Only the owner can change this.' : 'The setting could not be saved. Try again.' };
      return { ok: true };
    } catch { return { ok: false, message: 'Select a business you can access first.' }; }
  }

  /** "Not helpful" on one of this member's answers, for CACU's weekly review: a reason code only, never any text. */
  async notHelpful(input: AIBooksFeedback): Promise<{ ok: boolean; message?: string }> {
    const parsed = feedbackSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: 'Choose one of the reasons.' };
    try {
      const { supabase } = await this.context(parsed.data.businessId);
      const { data, error } = await supabase.rpc('rate_ai_books', { p_business_id: parsed.data.businessId,
        p_request_key: parsed.data.requestKey, p_reason: parsed.data.reason });
      if (error || data !== true) return { ok: false, message: 'Your feedback could not be saved. Try again.' };
      return { ok: true };
    } catch { return { ok: false, message: 'Select a business you can access first.' }; }
  }

  async ask(input: AIBooksRequest): Promise<AIBooksResult> {
    let context;
    try { context = await this.context(input?.businessId); }
    catch { return { ok: false, code: 'access_denied', message: 'Business access could not be verified. Refresh your session and selection.' }; }
    const parsed = requestSchema.safeParse(input ? { ...input, question: typeof input.question === 'string' ? inert(input.question, 2001) : input.question } : input);
    if (!parsed.success) return { ok: false, code: 'invalid', message: 'Enter a question of up to 2,000 characters.' };
    const model = configuredModel();
    if (!model) return { ok: false, code: 'unavailable', message: AI_BOOKS_UNAVAILABLE };
    const { supabase, businessId, user } = context;
    const request = { p_business_id: businessId, p_request_key: parsed.data.requestKey };
    const started = Date.now();
    const trace: BooksTrace = { tools: [], calls: [] };
    const tools = trace.tools;
    let reserved = false, tokens = [0, 0];
    const record = async (status: 'completed' | 'failed', check: 'passed' | 'flagged' | 'none') => {
      try { await supabase.rpc('record_ai_books', { ...request, p_tools: tools, p_input_tokens: tokens[0], p_output_tokens: tokens[1],
        p_latency_ms: Date.now() - started, p_figure_check: check, p_status: status }); } catch { /* metadata only; the answer stands */ }
    };
    try {
      // AI-004: the model receives the business category, the question and tool results; nothing else.
      const { data: business, error: sourceError } = await supabase.from('businesses').select('business_type').eq('id', businessId).single();
      if (sourceError || !['PRODUCT', 'SERVICE', 'HYBRID'].includes(business?.business_type)) {
        return { ok: false, code: 'failed', message: 'Business context is unavailable. Try again after refreshing.' };
      }
      const fingerprint = createHash('sha256').update(JSON.stringify({ version: 'books-1', model, businessId, question: parsed.data.question })).digest('hex');
      const { data, error } = await supabase.rpc('reserve_ai_books', { ...request, p_fingerprint: fingerprint, p_model: model });
      if (error) {
        if (error.message === 'AI_BOOKS_OFF' || error.message === 'AI_DISABLED') return { ok: false, code: 'unavailable', message: AI_BOOKS_OFF };
        if (error.message === 'AI_RATE_LIMIT') return { ok: false, code: 'rate_limit', message: 'The shared AI request limit has been reached. Please try later.' };
        if (error.message === 'AI_MONTHLY_LIMIT') return { ok: false, code: 'plan_limit', message: limitReachedLine(await this.allowance(supabase, businessId)) };
        if (error.message === 'AI_PLAN_SUSPENDED') return { ok: false, code: 'plan_limit', message: AI_SUSPENDED };
        return { ok: false, code: 'failed', message: 'Request reservation could not be confirmed. Check this same request before starting another.' };
      }
      if (data?.reserved === false) return { ok: false, code: 'duplicate', message: 'This question was already submitted. Its answer is not stored for recovery. Ask again only if you intend another request.' };
      if (data?.reserved !== true) throw new Error('Reservation unavailable');
      reserved = true;

      // Only the tools this member may use, as the accounting API lists them for this member; each tool runs with the
      // member's own session, so permissions apply exactly as on the screens.
      const catalogue = await accountingRequest<{ tools: OpenAITool[] }>('ai/tools');
      const answer = await answerFromBooks({ businessType: business.business_type, today: lagosToday(), question: parsed.data.question,
        catalogue: catalogue.tools ?? [], fetchTool: path => accountingRequest(`ai/tools/${path}`), trace });
      tokens = [answer.inputTokens, answer.outputTokens];
      const { text, check, sources, limitations } = answer;

      // Recheck identity after provider I/O; finishing also verifies membership in PostgreSQL.
      const current = await this.context(businessId);
      if (current.user.id !== user.id) throw new Error('Identity changed');
      const { data: finished, error: finishError } = await supabase.rpc('finish_ai_chat', { ...request, p_status: 'completed' });
      if (finishError || finished !== true) throw new Error('Completion not confirmed');
      await record('completed', check.status);
      return { ok: true, answer: text, check, sources, limitations, tools: [...new Set(tools)],
        allowance: allowanceLine(await this.allowance(supabase, businessId)) };
    } catch {
      if (reserved) {
        try { await supabase.rpc('finish_ai_chat', { ...request, p_status: 'failed' }); } catch { /* the reservation stays charged */ }
        await record('failed', 'none');
      }
      return { ok: false, code: 'failed', message: 'The answer could not be confirmed. This request will not be sent automatically again.' };
    }
  }
}
