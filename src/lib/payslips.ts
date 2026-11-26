// Payslip links (E21 R4): an approved payslip an employee opens by a link, without an account.

export type PublicPayslip = {
  business: { name: string; address: string | null };
  period: string;
  employee: { name: string; job_title: string | null; tax_id: string | null; pension_pin: string | null; pfa: string | null; tax_state: string | null };
  earnings: { basic: number; housing: number; transport: number; other: number; gross: number };
  deductions: { paye: number; pension: number; nhf: number; nhis: number };
  net: number; employer_pension: number; taxable_annual: number; approved_at: string | null; expires_at: string;
};

export type PayslipLinkStatus = { payslip_id: string; shared_at: string; expires_at: string; expired: boolean; open_count: number; last_opened_at: string | null };
export type SharedPayslip = { token: string; payslip_id: string; expires_at: string };

export const LINK_DAYS = [7, 30, 90] as const;
export const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export const payslipPath = (token: string) => `/payslip/${token}`;

/** A WhatsApp message carrying the link, for the sharer to send to the employee themselves. */
export function whatsappHref(name: string, period: string, url: string) {
  return `https://wa.me/?text=${encodeURIComponent(`Hello ${name}, here is your payslip for ${period}: ${url}`)}`;
}
