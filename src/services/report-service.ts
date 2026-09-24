
import { BaseService } from './base-service';

/**
 * @fileOverview ReportService provides high-performance financial intelligence.
 * Leverages PostgreSQL views and RPCs for server-side aggregation.
 */
export class ReportService extends BaseService {
  
  async getDashboardStats(startDate: string, endDate: string) {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) throw new Error('Business context required');

    // 1. Core Financials
    const { data: kpi, error: kpiError } = await supabase.rpc('get_business_kpis', {
      p_business_id: businessId,
      p_start_date: startDate,
      p_end_date: endDate
    });

    if (kpiError) throw kpiError;

    // 2. Inventory Context
    const { data: inv } = await supabase
      .from('view_inventory_valuation')
      .select('*')
      .eq('business_id', businessId)
      .maybeSingle();

    // 3. Operational Context (Jobs)
    const { count: activeJobs } = await supabase
      .from('jobs')
      .select('*', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .neq('status', 'Completed')
      .neq('status', 'Cancelled');

    return {
      financials: kpi[0] || { total_income: 0, total_expense: 0, net_profit: 0, transaction_count: 0 },
      inventory: inv || { total_skus: 0, total_asset_value: 0, low_stock_count: 0 },
      jobs: { activeCount: activeJobs || 0 }
    };
  }

  async getRevenueTrend(startDate: string, endDate: string, interval: 'day' | 'week' | 'month' = 'month') {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) return [];

    const { data, error } = await supabase.rpc('get_revenue_trend', {
      p_business_id: businessId,
      p_start_date: startDate,
      p_end_date: endDate,
      p_interval: interval
    });

    if (error) throw error;
    return data || [];
  }

  async getProductPerformance() {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) return [];

    const { data, error } = await supabase
      .from('view_product_performance')
      .select('*')
      .eq('business_id', businessId)
      .order('units_sold', { ascending: false })
      .limit(10);

    if (error) throw error;
    return data || [];
  }

  async getAgingReport() {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) return [];

    const { data, error } = await supabase
      .from('view_receivables_aging')
      .select('*')
      .eq('business_id', businessId);

    if (error) throw error;
    return data || [];
  }

  async getProfitAndLoss(startDate: string, endDate: string) {
    const { financials } = await this.getDashboardStats(startDate, endDate);
    
    // Categorized breakdown
    const { supabase, businessId } = await this.getContext();
    const { data: categories } = await supabase
      .from('financial_transactions')
      .select('category, type, amount')
      .eq('business_id', businessId)
      .gte('date', startDate)
      .lte('date', endDate);

    const breakdown: Record<string, number> = {};
    categories?.forEach(c => {
      if (!breakdown[c.category]) breakdown[c.category] = 0;
      breakdown[c.category] += (c.type === 'Income' ? 1 : -1) * Number(c.amount);
    });

    return {
      income: financials.total_income,
      expenses: financials.total_expense,
      netProfit: financials.net_profit,
      categories: breakdown
    };
  }
}
