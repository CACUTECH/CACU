
import { BaseService } from './base-service';

export class LedgerService extends BaseService {
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

  async recordEntry(entry: any) {
    const { supabase, businessId, user } = await this.getContext();
    if (!businessId) throw new Error('Business context missing');

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
    return result;
  }
}
