// Fixed assets (R4; IAS 16): the register, monthly depreciation and disposals, as the accounting API returns them.

export const CATEGORIES = [
  ['computers', 'Computers and phones'], ['furniture', 'Furniture and fittings'], ['machinery', 'Plant and machinery'],
  ['vehicles', 'Motor vehicles'], ['buildings', 'Land and buildings'], ['other', 'Other equipment'],
] as const;
export type Category = typeof CATEGORIES[number][0];

export type FixedAsset = {
  id: string; name: string; category: Category; category_name: string; reference: string | null; acquired_on: string;
  how: 'paid' | 'credit' | 'existing'; method: 'straight_line' | 'reducing_balance'; useful_life_months: number | null; annual_rate_percent: string | null;
  cost: string; residual: string; accumulated_depreciation: string; carrying_amount: string; depreciate_from: string;
  disposed_on: string | null; disposal_proceeds: string | null; disposal_result?: string;
};
export type DepreciationRun = { month: string; entry_date: string; total: string; transaction_id: number | null; posted_at: string };
export type FixedAssets = {
  assets: FixedAsset[]; runs: DepreciationRun[]; due: string[];
  totals: { cost: string; accumulated_depreciation: string; carrying_amount: string };
  pay_from: { cash: boolean; banks: { id: string; name: string }[] };
  capital_allowances?: boolean;
};

/** Capital allowances (Nigeria Tax Act 2025) for one tax year, from the register. */
export type AllowanceRow = {
  asset_id: string; name: string; category: Category; tax_class: string; class_label: string; rate_percent: string; qualifies: boolean;
  cost: string; claimed_before: string; note: string | null; set: boolean; business_use_percent?: string; private_use?: string; earns_exempt?: boolean; exempt_use?: string;
  opening?: string; allowance?: string; proceeds?: string | null; balancing?: string; closing?: string;
};
export type CapitalAllowances = {
  year: number; assets: AllowanceRow[]; reviewed: boolean; note: string;
  totals: { allowance: string; balancing_charge: string; balancing_allowance: string };
  non_taxable?: { income: string; total_income: string; share_percent: string; applies: boolean; threshold_percent: string };
  classes: { tax_class: string; label: string; rate_percent: string }[];
};
export type AssetTaxInput = { tax_class: string; qualifies: boolean; claimed_before: string; note?: string | null; business_use?: string; earns_exempt?: boolean };
export type DepreciationPreview = { month: string; total: string; charges: { asset_id: string; name: string; category_name: string; amount: string }[] };

export type AssetInput = {
  name: string; category: Category; reference?: string; acquired_on: string; cost: string; residual: string;
  method: 'straight_line' | 'reducing_balance'; useful_life_months?: number | null; annual_rate_percent?: string | null;
  how: 'paid' | 'credit' | 'existing';
  vat?: string;
  pay_method?: 'Cash' | 'Transfer' | null; bank_account_id?: string | null;
  supplier_id?: string | null; bill_number?: string | null; due_date?: string | null;
  accumulated_depreciation?: string; brought_in_on?: string | null;
};
export type DisposeInput = { disposed_on: string; proceeds: string; vat?: string; method?: 'Cash' | 'Transfer' | null; bank_account_id?: string | null };

export const naira = (value: string | number) => `₦${Number(value).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const monthLabel = (month: string) => new Date(`${month.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-NG', { month: 'long', year: 'numeric' });

export function methodLabel(asset: Pick<FixedAsset, 'method' | 'useful_life_months' | 'annual_rate_percent'>) {
  if (asset.method === 'straight_line') {
    const months = asset.useful_life_months ?? 0;
    return `Straight-line over ${months % 12 === 0 ? `${months / 12} year${months === 12 ? '' : 's'}` : `${months} months`}`;
  }
  return `Reducing balance at ${Number(asset.annual_rate_percent)}% a year`;
}

/** A first idea of a month's straight-line charge, before the server works it out exactly. */
export function monthlyStraightLine(cost: string, residual: string, months: number | null | undefined) {
  const base = Number(cost) - Number(residual || 0);
  return months && base > 0 ? Math.round((base / months) * 100) / 100 : 0;
}
