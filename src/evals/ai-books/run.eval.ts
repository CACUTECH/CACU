/**
 * The Doc 15 evaluation runner for AI on the books (TEST-411, gate G4). Staging only, read-only, never part of `npm test`.
 *
 *   npm run ai:eval                         run every set (380 questions; each calls the model)
 *   AI_EVAL_SETS=refusals,plain npm run ai:eval      run some sets
 *   AI_EVAL_REVIEW=<run dir>/review.csv npm run ai:eval   score a filled review sheet against that run
 *
 * It signs in as each staging fixture member, asks every question through the same answering code owners get
 * (answerFromBooks: instructions, tool filtering, AI-001 figure check), calls each figure case's tool directly as the
 * oracle, grades the answers and writes results.json, review.csv and summary.md to evals/ai-books/results/<time>/.
 * Reservations and quotas are skipped: it uses the model directly with the staging key.
 *
 * Required: AI_EVAL_ENVIRONMENT=staging, AI_EVAL_SUPABASE_URL, AI_EVAL_SUPABASE_ANON_KEY, AI_EVAL_ACCOUNTING_API_URL (https),
 * AI_EVAL_FIXTURES (a JSON file outside the repository; see evals/ai-books/fixtures.example.json), OPENAI_API_KEY, and
 * OPENAI_MODEL or AI_EVAL_MODEL. Passwords come from the environment variables the fixture file names.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { OpenAITool } from '@/ai/openai';
import { answerFromBooks, toolQuery, type BooksTrace } from '@/lib/ai-books-answer';
import { routeParts, serviceUrl } from '@/lib/service-url';
import type { ToolResult } from '@/lib/ai-books';
import { buildSets, resolveArgs, OTHER_BUSINESS, type EvalCase, type Fixture, type SetName } from './sets';
import { gradeFigures, gradeIncomplete, gradeIsolation, gradePlain, gradeRefusal, pct, reviewSheet, scoreReview, summarise, valueAt,
  type Answer, type Outcome, type SetSummary } from './grade';

jest.mock('server-only', () => ({}), { virtual: true });
jest.setTimeout(6 * 60 * 60 * 1000);

class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }
type FixtureConfig = { business_id: string; email: string; password_env: string };
type Member = { client: SupabaseClient; token: string; businessId: string; businessType: string; catalogue: OpenAITool[] };

function lagosToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function settings() {
  const env = process.env;
  const need = (name: string) => { const v = env[name]?.trim(); if (!v) throw new Error(`${name} is required for the evaluation run.`); return v; };
  if (env.AI_EVAL_ENVIRONMENT !== 'staging') throw new Error('The evaluation runs against staging only: set AI_EVAL_ENVIRONMENT=staging.');
  const supabaseUrl = need('AI_EVAL_SUPABASE_URL'), apiUrl = need('AI_EVAL_ACCOUNTING_API_URL');
  // The app's own configuration may point at production; the evaluation must be pointed at staging explicitly.
  if ([env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_URL].includes(supabaseUrl) || apiUrl === env.CACU_ACCOUNTING_API_URL) {
    throw new Error('The evaluation targets match this app\'s configured environment. Point AI_EVAL_* at the staging project.');
  }
  if (new URL(apiUrl).protocol !== 'https:') throw new Error('AI_EVAL_ACCOUNTING_API_URL must use HTTPS.');
  if (env.AI_EVAL_MODEL) env.OPENAI_MODEL = env.AI_EVAL_MODEL;
  need('OPENAI_API_KEY'); need('OPENAI_MODEL');
  const file = JSON.parse(readFileSync(need('AI_EVAL_FIXTURES'), 'utf8')) as { fixtures: Partial<Record<Fixture, FixtureConfig>>; other_canary_names?: string[] };
  const sets = env.AI_EVAL_SETS?.split(',').map(s => s.trim()).filter(Boolean) as SetName[] | undefined;
  return { supabaseUrl, anonKey: need('AI_EVAL_SUPABASE_ANON_KEY'), apiUrl: new URL(apiUrl), fixtures: file.fixtures, otherNames: file.other_canary_names ?? [], sets };
}

async function api(base: URL, member: { token: string; businessId: string }, route: string): Promise<unknown> {
  const { segments, query } = routeParts(route);
  const response = await fetch(serviceUrl(base, ['api', 'v1', 'businesses', member.businessId, ...segments], query), {
    headers: { Authorization: `Bearer ${member.token}` }, redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok) {
    const body: { detail?: unknown } = await response.json().catch(() => ({}));
    throw new ApiError(typeof body.detail === 'string' ? body.detail.slice(0, 200) : `Request failed (${response.status})`, response.status);
  }
  return response.json();
}

function namesAndFigures(results: unknown[]): { names: Set<string>; figures: Set<string> } {
  const names = new Set<string>(), figures = new Set<string>();
  const walk = (v: unknown, key = '') => {
    if (v == null) return;
    if (Array.isArray(v)) return v.forEach(x => walk(x));
    if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).forEach(([k, x]) => walk(x, k));
    if (['name', 'customer'].includes(key) && typeof v === 'string') names.add(v);
    else if (typeof v === 'string' && /^-?\d+\.\d{2}$/.test(v)) figures.add(v);
  };
  results.forEach(r => walk((r as ToolResult)?.data));
  return { names, figures };
}

const PROBES = ['profit_summary?start_date={this_month}&end_date={today}', 'profit_summary?start_date={last_month}&end_date={last_month_end}',
  'cash_position', 'receivables', 'top_products?start_date={this_month}&end_date={today}&limit=20', 'lapsed_customers?days=30', 'top_expenses?start_date={this_month}&end_date={today}&limit=20'];

describe('AI on the books: Doc 15 evaluation (staging)', () => {
  const review = process.env.AI_EVAL_REVIEW;

  (review ? test : test.skip)('scores a filled review sheet', () => {
    const dir = dirname(resolve(review!));
    const outcomes = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8')).outcomes as Outcome[];
    const scored = scoreReview(readFileSync(review!, 'utf8'));
    const summary = summarise(outcomes, scored.figuresCorrect);
    writeFileSync(join(dir, 'summary-reviewed.md'), report(summary, outcomes, { ...scored }));
    console.log(report(summary, outcomes, scored));
    expect(scored.blank).toEqual([]);
    expect(scored.overturned).toEqual([]);
    expect(summary.filter(s => !s.met).map(s => s.set)).toEqual([]);
  });

  (review ? test.skip : test)('runs the sets against staging', async () => {
    const cfg = settings();
    const today = lagosToday();
    const members = new Map<Fixture, Member>();
    const member = async (fixture: Fixture): Promise<Member> => {
      const known = members.get(fixture);
      if (known) return known;
      const fx = cfg.fixtures[fixture];
      if (!fx) throw new Error(`The fixture file has no "${fixture}" business.`);
      const password = process.env[fx.password_env];
      if (!password) throw new Error(`${fx.password_env} is not set.`);
      const client = createClient(cfg.supabaseUrl, cfg.anonKey, { auth: { persistSession: false, autoRefreshToken: true } });
      const { data, error } = await client.auth.signInWithPassword({ email: fx.email, password });
      if (error || !data.session) throw new Error(`Sign-in failed for the "${fixture}" fixture.`);
      const { data: business } = await client.from('businesses').select('business_type').eq('id', fx.business_id).single();
      const m = { client, token: data.session.access_token, businessId: fx.business_id, businessType: business?.business_type ?? 'PRODUCT', catalogue: [] as OpenAITool[] };
      m.catalogue = ((await api(cfg.apiUrl, m, 'ai/tools')) as { tools: OpenAITool[] }).tools ?? [];
      members.set(fixture, m);
      return m;
    };
    const fill = (route: string) => route.replace(/\{(\w+)\}/g, (_, k) => String(resolveArgs({ x: k }, today).x));

    // Canaries: the other business's names and figures, less anything the complete business also has.
    const probe = async (fixture: Fixture) => namesAndFigures(await Promise.all(PROBES.map(p => api(cfg.apiUrl, members.get(fixture)!, `ai/tools/${fill(p)}`).catch(() => null))));
    await member('complete'); await member('other');
    const [mine, theirs] = [await probe('complete'), await probe('other')];
    const canaries = { names: [...new Set([...theirs.names, ...cfg.otherNames])].filter(n => !mine.names.has(n) && n !== OTHER_BUSINESS),
      figures: [...theirs.figures].filter(f => !mine.figures.has(f)) };

    const cases = buildSets().filter(c => !cfg.sets || cfg.sets.includes(c.set));
    const rows: { c: EvalCase; a: Answer; o: Outcome; expected?: string }[] = [];
    for (const c of cases) {
      const m = await member(c.fixture);
      let oracle: ToolResult | null = null;
      if (c.oracle) {
        const qs = toolQuery(resolveArgs(c.oracle.args, today));
        oracle = await api(cfg.apiUrl, m, `ai/tools/${c.oracle.tool}${qs ? `?${qs}` : ''}`).then(r => r as ToolResult).catch(() => null);
      }
      const trace: BooksTrace = { tools: [], calls: [] };
      let a: Answer;
      try {
        const run = await answerFromBooks({ businessType: m.businessType, today, question: c.question, catalogue: m.catalogue,
          fetchTool: path => api(cfg.apiUrl, m, `ai/tools/${path}`), trace });
        a = { text: run.text, check: run.check, results: run.results, calls: trace.calls, offered: run.offered };
      } catch {
        a = { text: '', check: { status: 'none', unchecked: [] }, results: [], calls: trace.calls, offered: m.catalogue.map(t => t.name), error: 'the model run failed' };
      }
      const o = c.set === 'figures' ? gradeFigures(c, a, oracle) : c.set === 'incomplete' ? gradeIncomplete(c, a)
        : c.set === 'isolation' ? gradeIsolation(c, a, canaries) : c.set === 'refusals' ? gradeRefusal(c, a) : gradePlain(c, a);
      const expected = c.oracle ? c.oracle.expect.map(p => `${p}=${String(valueAt(oracle, p) ?? '—')}`).join('; ') : c.limitation ?? c.kind ?? c.topic;
      rows.push({ c, a, o, expected });
    }

    const outcomes = rows.map(r => r.o);
    const dir = resolve(process.cwd(), 'evals', 'ai-books', 'results', new Date().toISOString().replace(/[:.]/g, '-'));
    mkdirSync(dir, { recursive: true });
    const meta = { today, model: process.env.OPENAI_MODEL, sets: cfg.sets ?? 'all', cases: cases.length };
    writeFileSync(join(dir, 'results.json'), JSON.stringify({ meta, outcomes,
      answers: rows.map(r => ({ id: r.c.id, question: r.c.question, answer: r.a.text, tools: r.a.calls, check: r.a.check })) }, null, 2));
    writeFileSync(join(dir, 'review.csv'), reviewSheet(rows));
    const summary = summarise(outcomes, null);
    writeFileSync(join(dir, 'summary.md'), report(summary, outcomes));
    console.log(`${report(summary, outcomes)}\nResults: ${dir}`);
    // Automatic bars only here; the figure set passes after the review sheet is scored.
    expect(summary.filter(s => s.set !== 'figures' && s.total && !s.met).map(s => s.set)).toEqual([]);
    expect(outcomes.filter(o => o.set === 'figures' && !o.figuresMatch).map(o => o.id)).toEqual([]);
  });
});

function report(summary: SetSummary[], outcomes: Outcome[], review?: ReturnType<typeof scoreReview>) {
  const lines = ['# AI on the books: evaluation', '', '| Set | Cases | Passed | Rate | Bar | Met |', '| --- | --- | --- | --- | --- | --- |',
    ...summary.map(s => `| ${s.set} | ${s.total} | ${s.passed} | ${pct(s.rate)} | ${pct(s.bar)} | ${s.met ? 'yes' : 'no'} |`), ''];
  for (const s of summary) if (s.note) lines.push(`- ${s.set}: ${s.note}`);
  const grades = outcomes.map(o => o.readingGrade).filter((g): g is number => typeof g === 'number');
  if (grades.length) lines.push(`- plain: median reading grade ${grades.sort((x, y) => x - y)[Math.floor(grades.length / 2)]} (reported, not a bar)`);
  if (review) lines.push(`- review: ${review.figuresReviewed}/${review.figuresTotal} figure answers judged; ${review.blank.length} blank; overturned: ${review.overturned.join(', ') || 'none'}`);
  const failed = outcomes.filter(o => !o.pass);
  if (failed.length) lines.push('', '## Failures', '', ...failed.map(o => `- ${o.id}: ${o.reasons.join('; ')}`));
  return lines.join('\n') + '\n';
}
