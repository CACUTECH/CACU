
import { usesPythonAccounting } from '@/lib/accounting-client';
import { BaseService } from './base-service';

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

  /**
   * Records a manual ledger entry with audit logging.
   */
  async recordEntry(entry: {
      description: string;
      amount: number;
      type: 'Income' | 'Expense';
      category: string;
      date?: string;
  }) {
    const { supabase, businessId, user, role } = await this.getContext();
    if (!businessId) throw new Error('Business context missing');

    if (!['owner', 'admin', 'editor'].includes(role)) throw new Error('Insufficient permissions');
    if (await usesPythonAccounting()) throw new Error('Use balanced accounting postings with reviewed account mappings; single-entry records are disabled after cutover');
    // Server-side validation of financial values
    if (entry.amount === 0) throw new Error('Transaction amount cannot be zero');

    const data = {
      ...entry,
      business_id: businessId,
      created_by: user.id,
      date: entry.date || new Date().toISOString().split('T')[0]
    };

    const { data: result, error } = await supabase
      .from('financial_transactions')
      .insert(data)
      .select()
      .single();

    if (error) throw error;

    // Manual audit log for traceable manual adjustments
    const { error: auditError } = await supabase.rpc('record_audit', {
        p_business_id: businessId,
        p_action: 'MANUAL_JOURNAL_ENTRY',
        p_table: 'financial_transactions',
        p_record_id: result.id,
        p_details: { amount: entry.amount, type: entry.type }
    });
    if (auditError) console.warn('Audit logging failed, but transaction committed.', auditError);

    return result;
  }
}
