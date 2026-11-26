// Funding readiness (Doc 15; E19 R3 part 1): what the accounting API returns, and how measures are shown.
export type Measure = { key: string; label: string; unit: 'percent' | 'ratio' | 'days' | 'count'; best: string; worst: string;
  value: string | null; score: number | null; note: string | null };
export type Dimension = { key: string; label: string; weight: number; share: string | null; score: number | null; measures: Measure[] };
export type Assessment = { id: string; assessed_on: string; created_at: string; model_version: string; score: number;
  band: 'strong' | 'developing' | 'early' | 'not_yet_ready'; band_label: string; band_text: string; based_on: number;
  dimensions: Dimension[]; notice: string; limitations: string[]; label: string;
  period: { start_date: string; end_date: string; months: number };
  information: { stock_turnover?: { label: string; value: string } } };
export type Eligibility = { eligible: boolean; missing: { key: string; message: string }[]; earliest_date: string | null };
export type FundingOverview = { available: boolean; level: string; message: string | null; notice: string; limitations: string[];
  eligibility: Eligibility | null; latest: Assessment | null; assessed_today: boolean };

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
