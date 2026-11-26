// Funding readiness (Doc 15; E19 R3 parts 1 and 2): what the accounting API returns, and how measures are shown.
export type Measure = { key: string; label: string; unit: 'percent' | 'ratio' | 'days' | 'count'; best: string; worst: string;
  value: string | null; score: number | null; note: string | null };
/** recommendations: up to three for a dimension below 60 (FRA-002); null when the plan does not include them. */
export type Dimension = { key: string; label: string; weight: number; share: string | null; score: number | null; measures: Measure[];
  recommendations?: string[] | null };
export type Assessment = { id: string; kind: 'request' | 'monthly'; recommendations_included: boolean; assessed_on: string; created_at: string; model_version: string; score: number;
  band: 'strong' | 'developing' | 'early' | 'not_yet_ready'; band_label: string; band_text: string; based_on: number;
  dimensions: Dimension[]; notice: string; limitations: string[]; label: string;
  period: { start_date: string; end_date: string; months: number };
  information: { stock_turnover?: { label: string; value: string } } };
export type Eligibility = { eligible: boolean; missing: { key: string; message: string }[]; earliest_date: string | null };
export type HistoryItem = { id: string; kind: 'request' | 'monthly'; assessed_on: string; score: number; band: Assessment['band'];
  band_label: string; model_version: string; period: { start_date: string; end_date: string } };
/** history: past assessments, newest first, on the Oga and Chairman plans (FRA-003, FRA-005); null otherwise. */
export type FundingOverview = { available: boolean; level: string; message: string | null; notice: string; limitations: string[];
  eligibility: Eligibility | null; latest: Assessment | null; assessed_today: boolean; history: HistoryItem[] | null };

/** The change from the assessment before, in points, or null for the first one. */
export function scoreChange(history: HistoryItem[], index: number): number | null {
  const before = history[index + 1];
  return before ? history[index].score - before.score : null;
}

/** FRA-009: shown on every funding readiness screen, whatever the API returns. */
export const FUNDING_NOTICE = 'This is an indicative self-assessment based on your CACU records. It is not a credit rating, credit report or offer of finance.';

export function showMeasure(value: string, unit: Measure['unit']): string {
  const n = Number(value);
  if (unit === 'percent') return `${n.toLocaleString('en-NG', { maximumFractionDigits: 1 })}%`;
  if (unit === 'days') return `${n.toLocaleString('en-NG', { maximumFractionDigits: 1 })} days`;
  if (unit === 'count') return Math.round(n).toLocaleString('en-NG');
  return n.toLocaleString('en-NG', { maximumFractionDigits: 2 });
}

export function showDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function asHistory(a: Assessment): HistoryItem {
  return { id: a.id, kind: a.kind, assessed_on: a.assessed_on, score: a.score, band: a.band, band_label: a.band_label,
    model_version: a.model_version, period: { start_date: a.period.start_date, end_date: a.period.end_date } };
}

// --- Part 3: the lender pack (FRA-006..008) ------------------------------------------------------------------------
type Line = { code: string | null; name: string; amounts: string[] };
type Section = { key: string; title: string; lines: Line[]; total: string[] };
/** What a lender sees: a fixed snapshot, never the books (FRA-006, FRA-008). */
export type FundingPack = {
  kind: 'cacu_funding_pack'; version: number; notice: string; label: string; prepared_on: string;
  business: { name: string | null; business_type: string | null; address: string | null; books_started: string | null };
  period: { start_date: string; end_date: string; months: number };
  statements: { tier: string; basis: string; currency: string; checks: string[];
    income_statement: { sections: Section[]; gross_profit: string[]; net_profit: string[] };
    financial_position: { sections: Section[]; total_assets: string[]; total_liabilities: string[]; total_equity: string[] };
    changes_in_equity: { lines: { code: string | null; name: string; opening: string; movement: string; closing: string }[];
      total: { opening: string; movement: string; closing: string }; profit_for_period: string };
    cash_flow: { sections: { key: string; lines: { label: string; amount: string }[]; total: string }[];
      opening_cash: string | null; net_change: string | null; closing_cash: string | null; reconciled: boolean | null; note: string | null } };
  assessment: { assessed_on: string; kind: string; model_version: string; score: number; band: Assessment['band']; band_label: string;
    band_text: string; based_on: number; dimensions: Dimension[]; information: Assessment['information'] };
  completeness: { months: number; dimensions_used: number; dimensions_total: number; trading_days_recorded: string | null;
    open_exceptions_when_prepared: number; not_worked_out: string[]; notes: string[] };
};
export type ShareDraft = { assessment_id?: string; recipient_name: string; recipient_organisation?: string | null; purpose: string; expires_in_days: number };
export type SharePreview = ShareDraft & { pack: FundingPack; pack_sha256: string };
export type FundingShare = { id: string; assessment_id: string; recipient_name: string; recipient_organisation: string | null; purpose: string;
  created_at: string; expires_at: string; withdrawn_at: string | null; status: 'live' | 'expired' | 'withdrawn'; pack_sha256: string;
  times_opened?: number; openings?: { opened_at: string; outcome: 'opened' | 'expired' | 'withdrawn' | 'switched_off' }[]; token?: string | null };
/** What the public link returns: the pack while the link is live, otherwise only why not. */
export type PublicPack = { status: 'opened'; recipient_name: string; recipient_organisation: string | null; purpose: string; shared_at: string;
  expires_at: string; pack: FundingPack } | { status: 'expired' | 'withdrawn' | 'switched_off' };

export const SHARE_DAYS = [7, 14, 30, 60, 90] as const;

export function naira(value: string | null | undefined): string {
  const n = Number(value ?? 0);
  const text = `₦${Math.abs(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n < 0 ? `(${text})` : text;
}

export function showMoment(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Lagos' });
}
