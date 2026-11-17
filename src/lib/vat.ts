// VAT (Doc 09 PR-32; E14 R3 part 2a): what the accounting API returns for Settings › Taxes and the VAT return.
export type VatClass = 'standard' | 'zero_rated' | 'exempt';
export type VatOverview = { registered: boolean; vat_number: string | null; effective_from: string | null; invoices_include_vat: boolean;
  standard_rate: string; items: { id: string; name: string; vat_class: VatClass }[] };
export type VatSide = { standard_net: string; zero_rated_net: string; exempt_net: string; vat: string; documents: number };
export type VatReturn = { month: string; vat_number: string | null; sales: VatSide; purchases: VatSide; payable: string; exceptions: string[]; note: string };

export const VAT_CLASS_LABELS: Record<VatClass, string> = { standard: 'Standard rate', zero_rated: 'Zero-rated', exempt: 'Exempt' };
export const naira = (value: string) => `₦${Number(value).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** A rate as people write it: "7.5%" rather than "7.5000". */
export const percent = (rate: string) => `${Number(rate)}%`;
/** Nigerian VAT numbers (TIN) are 6 to 20 letters, digits and dashes; checked again by the API. */
export const validVatNumber = (value: string) => /^[0-9A-Za-z-]{6,20}$/.test(value.trim());
export type VatStatus = { charging: boolean; standard_rate: string | null };

/** The most VAT the standard rate allows, in naira: on an amount before VAT, or inside a total that includes it. */
export function mostVat(amount: string, rate: string, inclusive: boolean): string {
  const kobo = Math.round(Number(amount) * 100), r = Number(rate);
  if (!Number.isFinite(kobo) || kobo <= 0 || !r) return '0.00';
  return (Math.round(inclusive ? kobo * r / (100 + r) : kobo * r / 100) / 100).toFixed(2);
}
