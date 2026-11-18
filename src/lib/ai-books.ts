// AI on the books (Doc 15; E18 R3): the pieces of the gateway that need no server, so the screen, the gateway and the
// evaluation runner check answers the same way.

export type ToolSource = { screen: string; path: string };
export type ToolPeriod = { start_date: string; end_date: string } | { as_of: string };
export type ToolResult = { tool: string; period: ToolPeriod; source: ToolSource; data: unknown; limitations: string[]; label: string };
export type FigureCheck = { status: 'passed' | 'flagged' | 'none'; unchecked: string[] };
export type BooksSource = ToolSource & { period: string };
export type BooksAnswer = { answer: string; check: FigureCheck; sources: BooksSource[]; limitations: string[]; tools: string[] };

export const AI_BOOKS_LABEL = 'Written by AI from your CACU books. It may be wrong, and it is not financial, legal or tax advice.';

/** Text as inert data (AI-007): no markup, no control or invisible format characters; line breaks kept. */
export function inert(text: string, limit = 4000): string {
  return text.replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁩﻿]/g, ' ')
    .replace(/[ \t]+/g, ' ').trim().slice(0, limit);
}

/** A figure in canonical form: no ₦, commas, spaces or %, no trailing decimal zeros; "−" read as minus. */
export function canonical(raw: string): string | null {
  const text = raw.replace(/[₦,\s%]/g, '').replace(/^[−–]/, '-').replace(/^N(?=\d)/, '');
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const [whole, fraction = ''] = text.replace(/^-/, '').split('.');
  const digits = whole.replace(/^0+(?=\d)/, '');
  const decimals = fraction.replace(/0+$/, '');
  const sign = text.startsWith('-') && (Number(digits) > 0 || decimals) ? '-' : '';
  return sign + (decimals ? `${digits}.${decimals}` : digits);
}

const FIGURE = /(?<![\w.])[-−–]?(?:₦|N(?=\d))?\s?\d[\d,]*(?:\.\d+)?%?/g;

function collect(value: unknown, into: Set<string>, key = '') {
  if (value == null) return;
  if (Array.isArray(value)) { into.add(String(value.length)); value.forEach(v => collect(v, into)); return; }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) { collect(k, into); collect(v, into, k); }
    return;
  }
  const text = String(value);
  void key;
  for (const match of text.match(/\d+(?:\.\d+)?/g) ?? []) { const c = canonical(match); if (c) into.add(c); }
}

/** AI-001: every figure in the answer must appear in this turn's tool results (or the question). Figures that do not
 *  are flagged, never silently passed: amounts, counts, percentages and date parts alike. */
export function checkFigures(answer: string, results: unknown[], question = ''): FigureCheck {
  const known = new Set<string>();
  results.forEach(r => collect(r, known));
  collect(question, known);
  const found = answer.match(FIGURE) ?? [];
  if (!found.length) return { status: 'none', unchecked: [] };
  const unchecked = [...new Set(found.map(f => f.trim()).filter(f => {
    const c = canonical(f);
    return c != null && !known.has(c.replace(/^-/, ''));
  }))];
  return { status: unchecked.length ? 'flagged' : 'passed', unchecked };
}

function periodText(p: ToolPeriod): string {
  return 'as_of' in p ? `at ${p.as_of}` : p.start_date === p.end_date ? `on ${p.start_date}` : `${p.start_date} to ${p.end_date}`;
}

const SAFE_PATH = /^\/[a-z0-9\-/]{0,80}$/;

/** AI-002 and AI-003: where each figure came from, and every limitation the tools reported, whatever the model wrote. */
export function sourcesAndLimits(results: ToolResult[]): { sources: BooksSource[]; limitations: string[] } {
  const sources = new Map<string, BooksSource>();
  const limitations = new Set<string>();
  for (const r of results) {
    if (!r || typeof r !== 'object' || !r.source || !SAFE_PATH.test(r.source.path)) continue;
    const period = periodText(r.period);
    sources.set(`${r.source.path}|${period}`, { screen: inert(r.source.screen, 60), path: r.source.path, period });
    (r.limitations ?? []).forEach(l => limitations.add(inert(l, 300)));
  }
  return { sources: [...sources.values()], limitations: [...limitations] };
}
