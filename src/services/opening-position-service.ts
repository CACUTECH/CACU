import { BaseService } from './base-service';

export type OpeningAnswers = {
  as_of: string; cash: string; banks: { account_id: string; amount: string }[];
  customers: { customer_id: string; amount: string }[]; suppliers: { supplier_id: string; amount: string }[];
  loans: string; capital: string; notes: string;
};
export type OpeningLine = { code: string; account_id: string; name: string; side: 'debit' | 'credit'; amount: string; party_type?: string; party_id?: string };
export type OpeningSummary = Record<'cash' | 'banks' | 'stock' | 'customers' | 'owns' | 'suppliers' | 'loans' | 'owes' | 'owner_equity' | 'capital' | 'retained', string>;
export type OpeningPosition = {
  chart_ready: boolean; books_active: boolean; stock_value: string;
  bank_accounts: { id: string; name: string }[]; customers: { id: string; name: string }[]; suppliers: { id: string; name: string }[];
  position: null | { version: number; status: 'draft' | 'approved'; as_of: string; answers: OpeningAnswers; summary: OpeningSummary;
    journal: { entry_date: string; lines: OpeningLine[] }; approved_at: string | null; approved_by: string | null };
  replayed?: boolean;
};

const MESSAGES: Record<string, string> = {
  ACCESS_DENIED: 'Only Owners and Admins can start the books.',
  CHART_REQUIRED: 'Set up the standard accounts first, in Chart of Accounts.',
  BOOKS_ALREADY_SET_UP: 'Your books are already started.',
  VERSION_CONFLICT: 'Someone else changed these answers. Reload to see the latest version.',
  INVALID_OPENING_POSITION: 'Check the amounts (no negatives, at most 2 decimal places), that each customer and supplier appears once, and that the date is not in the future.',
  ACCOUNT_NOT_FOUND: 'One of the bank accounts is not in your chart of accounts.',
  CUSTOMER_NOT_FOUND: 'One of the customers is not in your active business.',
  SUPPLIER_NOT_FOUND: 'One of the suppliers is not in your active business.',
  REQUEST_KEY_REUSED: 'These answers were already submitted with different details. Reload and try again.',
};

/** Error with a reviewed message; `uncertain` means the change may have been saved. */
export class OpeningPositionError extends Error {
  constructor(message: string, public readonly uncertain: boolean) { super(message); this.name = 'OpeningPositionError'; }
}

function failure(error: { message?: string }): never {
  const code = /^[A-Z_]+/.exec(error.message || '')?.[0] || '';
  if (MESSAGES[code]) throw new OpeningPositionError(MESSAGES[code], false);
  throw new OpeningPositionError('The change was not confirmed. Retry to check whether it was saved.', true);
}

/** Start your books (save_opening_position, approve_opening_position; Doc 09 PR-01, ACC-016). */
export class OpeningPositionService extends BaseService {
  async get(): Promise<OpeningPosition> {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) throw new OpeningPositionError('Business context missing', false);
    const { data, error } = await supabase.rpc('opening_position', { p_business_id: businessId });
    if (error) failure(error);
    return data as OpeningPosition;
  }

  async save(requestKey: string, version: number, answers: OpeningAnswers): Promise<OpeningPosition> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestKey || '')) throw new OpeningPositionError('The request was invalid. Refresh and try again.', false);
    const { supabase, businessId } = await this.getContext();
    if (!businessId) throw new OpeningPositionError('Business context missing', false);
    const { data, error } = await supabase.rpc('save_opening_position', { p_business_id: businessId, p_request_key: requestKey, p_version: version, p_answers: answers });
    if (error) failure(error);
    return data as OpeningPosition;
  }

  async approve(version: number, note: string): Promise<OpeningPosition> {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) throw new OpeningPositionError('Business context missing', false);
    const { data, error } = await supabase.rpc('approve_opening_position', { p_business_id: businessId, p_version: version, p_note: note || null });
    if (error) failure(error);
    return data as OpeningPosition;
  }
}
