import { BaseService } from './base-service';

export type ChartAccount = { id: string; code: string; name: string; account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  purpose: string | null; flow_section: string | null; is_active: boolean };
export type ChartOfAccounts = {
  template: { version: string; status: 'pending_review' | 'reviewed'; reviewed_by: string | null; reviewed_at: string | null; adopted_at: string } | null;
  books_active: boolean; accounts: ChartAccount[];
};

const CHART_MESSAGES: Record<string, string> = {
  ACCESS_DENIED: 'Only Owners and Admins can set up the chart of accounts.',
  BOOKS_ALREADY_SET_UP: 'Your books are already set up, so the standard accounts cannot be added again.',
  CHART_EXISTS: 'This business already has accounts. Ask CACU support to review them before starting your books.',
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
}
