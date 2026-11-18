// Customer segments (E06 R3): the rule set and what the accounting API returns.
export type Rules = { spent_at_least?: { amount: string; days: number }; spent_less_than?: { amount: string; days: number };
  no_purchase_for?: { days: number }; bought_within?: { days: number }; owes_at_least?: string; tags_any?: string[] };
export type Member = { id: string; name: string; phone: string | null; tags: string[]; owes: string; last_purchase: string | null;
  days_since: number | null; spent_90_days: string; lifetime_value?: string };
export type Members = { customers: Member[]; count: number; lifetime_value: boolean };
export type Segment = { id: string; name: string; rules: Rules; customers: number };
export type Overview = { segments: Segment[]; tags: string[]; customers: number; lifetime_value: boolean };

/** A rule set in plain words, for the list of saved segments. */
export function describe(rules: Rules): string {
  const naira = (v: string) => `₦${Number(v).toLocaleString('en-NG')}`;
  const parts: string[] = [];
  if (rules.spent_at_least) parts.push(`spent ${naira(rules.spent_at_least.amount)} or more in ${rules.spent_at_least.days} days`);
  if (rules.spent_less_than) parts.push(`spent under ${naira(rules.spent_less_than.amount)} in ${rules.spent_less_than.days} days`);
  if (rules.bought_within) parts.push(`bought in the last ${rules.bought_within.days} days`);
  if (rules.no_purchase_for) parts.push(`no purchase in ${rules.no_purchase_for.days} days`);
  if (rules.owes_at_least) parts.push(`owes ${naira(rules.owes_at_least)} or more`);
  if (rules.tags_any?.length) parts.push(`tagged ${rules.tags_any.join(' or ')}`);
  return parts.join(', and ');
}

// The segment form: each box as typed; an empty box is a rule not used.
export type Draft = { spentAmount: string; spentDays: string; underAmount: string; underDays: string; quietDays: string; recentDays: string; owes: string; tags: string };
export const EMPTY: Draft = { spentAmount: '', spentDays: '90', underAmount: '', underDays: '90', quietDays: '', recentDays: '', owes: '', tags: '' };

/** The rule set the form describes, or a problem to show. Empty boxes are rules not used. */
export function rulesFrom(d: Draft): Rules | string {
  const amount = (v: string) => /^\d{1,13}(\.\d{1,2})?$/.test(v.trim()), days = (v: string) => /^\d{1,4}$/.test(v.trim()) && Number(v) >= 1;
  const rules: Rules = {};
  if (d.spentAmount.trim()) { if (!amount(d.spentAmount) || !days(d.spentDays)) return 'Check the "spent at least" amount and days.'; rules.spent_at_least = { amount: d.spentAmount.trim(), days: Number(d.spentDays) }; }
  if (d.underAmount.trim()) { if (!amount(d.underAmount) || !days(d.underDays)) return 'Check the "spent less than" amount and days.'; rules.spent_less_than = { amount: d.underAmount.trim(), days: Number(d.underDays) }; }
  if (d.quietDays.trim()) { if (!days(d.quietDays)) return 'Check the "no purchase for" days.'; rules.no_purchase_for = { days: Number(d.quietDays) }; }
  if (d.recentDays.trim()) { if (!days(d.recentDays)) return 'Check the "bought in the last" days.'; rules.bought_within = { days: Number(d.recentDays) }; }
  if (d.owes.trim()) { if (!amount(d.owes)) return 'Check the "owes at least" amount.'; rules.owes_at_least = d.owes.trim(); }
  const tags = d.tags.split(',').map(t => t.trim()).filter(Boolean);
  if (tags.length) rules.tags_any = tags;
  return Object.keys(rules).length ? rules : 'Fill in at least one rule.';
}
