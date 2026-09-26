
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

  /**
   * Simplified balance sheet: no liabilities are tracked in this schema,
   * so equity is derived entirely from cumulative cash + inventory value.
   */
  async getBalanceSheet() {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) {
      return { assets: { cash: 0, inventory: 0, total: 0 }, equity: { retainedEarnings: 0, total: 0 } };
    }

    const { data: transactions, error: txError } = await supabase
      .from('financial_transactions')
      .select('type, amount')
      .eq('business_id', businessId);

    if (txError) throw txError;

    const cash = (transactions || []).reduce(
      (sum, t) => sum + (t.type === 'Income' ? 1 : -1) * Number(t.amount),
      0
    );

    const { data: items, error: invError } = await supabase
      .from('catalog_items')
      .select('unit_price, stock_quantity')
      .eq('business_id', businessId)
      .eq('item_type', 'PRODUCT');

    if (invError) throw invError;

    const inventory = (items || []).reduce(
      (sum, item) => sum + Number(item.unit_price) * Number(item.stock_quantity),
      0
    );

    const totalAssets = cash + inventory;

    return {
      assets: { cash, inventory, total: totalAssets },
      // No liabilities are tracked in this schema, so equity balances the sheet:
      // total equity = total assets. Retained earnings isolates the P&L-derived
      // (cash) component from inventory value for display purposes.
      equity: { retainedEarnings: cash, total: totalAssets }
    };
  }
}
