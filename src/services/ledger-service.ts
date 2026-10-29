
import { usesPythonAccounting } from '@/lib/accounting-client';
import { BaseService } from './base-service';

/** Messages are reviewed and safe to show; `uncertain` means the entry may have been recorded. */
export class LedgerEntryError extends Error {
  constructor(message: string, public readonly uncertain: boolean) { super(message); this.name = 'LedgerEntryError'; }
}
const LEDGER_MESSAGES: Record<string, string> = {
  ACCESS_DENIED: 'Only Owners, Admins and Editors can record ledger entries.',
  INVALID_LEDGER_ENTRY: 'Enter a description, an amount above zero with at most two decimal places, and a date that is not in the future.',
  USE_ACCOUNTING_POSTINGS: 'Use balanced accounting postings with reviewed account mappings; single-entry records are disabled after cutover',
  REQUEST_KEY_REUSED: 'This entry was already submitted with different details. Refresh and try again.',
};

/**
 * @fileOverview LedgerService manages high-integrity financial records.
 * Provides the system of record for Profit & Loss reporting.
 */
export class LedgerService extends BaseService {
  /**
   * Retrieves transaction history for the active tenant.
   */
  async getRecentTransactions() {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) return [];

    const { data, error } = await supabase
      .from('financial_transactions')
      .select('*')
      .eq('business_id', businessId)
      .order('date', { ascending: false });

    if (error) throw error;
    return data;
  }

  async listTransactionsPage(page = 0) {
    if (!Number.isSafeInteger(page) || page < 0 || page > 100000) throw new Error('Invalid ledger page');
    const { supabase, businessId } = await this.getContext();
    if (!businessId) throw new Error('Select an authorized business');
    const { data, count, error } = await supabase.from('financial_transactions')
      .select('id,date,description,amount,type,category,business_id', { count: 'exact' })
      .eq('business_id', businessId)
      .order('date', { ascending: false }).order('id', { ascending: false })
      .range(page * 20, page * 20 + 19);
    if (error) throw new Error('Ledger records unavailable');
    return { data: data || [], total: count || 0 };
  }

  /**
   * Records a manual ledger entry with audit logging.
   */
  /**
   * Records a manual ledger entry through record_ledger_entry_safe, which writes the entry and its
   * audit row together and replays a retried request key instead of posting twice.
   */
  async recordEntry(entry: {
      description: string;
      amount: number;
      type: 'Income' | 'Expense';
      category: string;
      date?: string;
      requestKey: string;
  }) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.requestKey || '')) {
      throw new LedgerEntryError('The entry request was invalid. Refresh and try again.', false);
    }
    const { supabase, businessId, role } = await this.getContext();
    if (!businessId) throw new LedgerEntryError('Business context missing', false);
    if (!['owner', 'admin', 'editor'].includes(role)) throw new LedgerEntryError('Insufficient permissions', false);
    if (await usesPythonAccounting()) throw new LedgerEntryError('Use balanced accounting postings with reviewed account mappings; single-entry records are disabled after cutover', false);
    if (!Number.isFinite(entry.amount) || entry.amount <= 0) throw new LedgerEntryError('Enter an amount above zero.', false);

    const { data, error } = await supabase.rpc('record_ledger_entry_safe', {
      p_business_id: businessId, p_request_key: entry.requestKey, p_description: entry.description,
      p_amount: String(entry.amount), p_type: entry.type, p_category: entry.category, p_date: entry.date || null,
    });
    if (error) {
      const code = /^[A-Z_]+/.exec(error.message || '')?.[0] || '';
      const definite = /^(22|23|42|P0001)/.test(error.code || '');
      throw new LedgerEntryError(LEDGER_MESSAGES[code] || (definite ? 'The entry could not be recorded.' : 'The entry was not confirmed. Retry to check whether it was recorded.'), !definite);
    }
    if (!data) throw new LedgerEntryError('The entry was not confirmed. Retry to check whether it was recorded.', true);
    return data;
  }
}
