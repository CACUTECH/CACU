import { BaseService } from './base-service';
import { accountingRequest } from '@/lib/accounting-client';

export type ChartAccount = { id: string; code: string; name: string; account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  purpose: string | null; flow_section: string | null; is_active: boolean; system?: boolean; added?: boolean };
export type AccountKind = 'bank' | 'current_asset' | 'fixed_asset' | 'current_liability' | 'loan' | 'equity' | 'income' | 'other_income' | 'expense' | 'other_expense';
export type AccountChange = { operation: 'add' | 'rename' | 'archive' | 'restore'; request_key: string; account_id?: string; name?: string; kind?: AccountKind };
export type ChartOfAccounts = {
  template: { version: string; status: 'pending_review' | 'reviewed'; reviewed_by: string | null; reviewed_at: string | null; adopted_at: string } | null;
  books_active: boolean; accounts: ChartAccount[];
};

const CHART_MESSAGES: Record<string, string> = {
  ACCESS_DENIED: 'Only Owners and Admins can set up the chart of accounts.',
  BOOKS_ALREADY_SET_UP: 'Your books are already set up, so the standard accounts cannot be added again.',
  CHART_EXISTS: 'This business already has accounts. Ask CACU support to review them before starting your books.',
  CHART_NOT_ADOPTED: 'Set up the standard accounts first.',
  DUPLICATE_ACCOUNT_NAME: 'Another account already has that name.',
  INVALID_NAME: 'Enter a name of up to 100 characters.',
  INVALID_ACCOUNT_KIND: 'Choose what kind of account this is.',
  CODE_RANGE_FULL: 'There is no free code left for this kind of account.',
  SYSTEM_ACCOUNT: 'Automatic postings use this account, so it cannot be archived.',
  ACCOUNT_HAS_BALANCE: 'This account has a balance. Move the balance to another account with a journal before archiving it.',
  ACCOUNT_NOT_FOUND: 'That account no longer exists. Refresh the page.',
};

/** Reads and adopts the reviewed default chart (adopt_default_chart, chart_of_accounts; Doc 09 section 4). */
export class ChartService extends BaseService {
  async get(): Promise<ChartOfAccounts> {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) throw new Error('Business context missing');
    const { data, error } = await supabase.rpc('chart_of_accounts', { p_business_id: businessId });
    if (error) throw new Error('The chart of accounts could not be loaded.');
    return data as ChartOfAccounts;
  }

  async adopt(requestKey: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestKey || '')) throw new Error('The request was invalid. Refresh and try again.');
    const { supabase, businessId } = await this.getContext();
    if (!businessId) throw new Error('Business context missing');
    const { data, error } = await supabase.rpc('adopt_default_chart', { p_business_id: businessId, p_request_key: requestKey });
    if (error) {
      const code = /^[A-Z_]+/.exec(error.message || '')?.[0] || '';
      throw new Error(CHART_MESSAGES[code] || 'The accounts were not confirmed. Retry to check whether they were added.');
    }
    return data as { version: string; mode: string; accounts: number; replayed: boolean };
  }

  /** FR-131. Once the books are live a new account also needs a ledger account, so adding goes through the accounting API. */
  async change(change: AccountChange, booksActive: boolean) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(change.request_key || '')) throw new Error('The request was invalid. Refresh and try again.');
    if (change.operation === 'add' && booksActive) {
      return accountingRequest<ChartAccount>('accounts', { method: 'POST', body: { request_key: change.request_key, kind: change.kind, name: change.name } });
    }
    const { supabase, businessId } = await this.getContext();
    if (!businessId) throw new Error('Business context missing');
    const details = change.operation === 'add' ? { kind: change.kind, name: change.name } : change.operation === 'rename' ? { name: change.name } : {};
    const { data, error } = await supabase.rpc('save_account', { p_business_id: businessId, p_request_key: change.request_key, p_operation: change.operation,
      p_account_id: change.account_id ?? null, p_data: details });
    if (error) {
      const code = /^[A-Z_]+/.exec(error.message || '')?.[0] || '';
      throw new Error(CHART_MESSAGES[code] || 'The change was not confirmed. Refresh to check whether it was saved.');
    }
    return data as ChartAccount;
  }
}
