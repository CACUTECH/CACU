
import { getAccountingSummary, usesPythonAccounting } from '@/lib/accounting-client';
import { BaseService } from './base-service';

/**
 * @fileOverview ReportService provides high-performance financial intelligence.
 * Leverages PostgreSQL views and RPCs for server-side aggregation.
 */
export class ReportService extends BaseService {
  
  async getDashboardStats(startDate: string, endDate: string) {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) throw new Error('Business context required');

    const migrated = await usesPythonAccounting();
    const summary = migrated ? await getAccountingSummary(startDate, endDate) : null;
    // Operational counts continue using Supabase; financial amounts use the canonical ledger.
    // 1. Core Financials
    const { data: kpi, error: kpiError } = summary ? { data: [{ total_income: summary.income, total_expense: summary.expenses, net_profit: summary.net_profit, transaction_count: summary.transaction_count }], error: null } : await supabase.rpc('get_business_kpis', {
      p_business_id: businessId,
      p_start_date: startDate,
      p_end_date: endDate
    });

    if (kpiError) throw kpiError;

    // 2. Inventory Context
    const { data: inv, error: inventoryError } = await supabase
      .from('view_inventory_valuation')
      .select('*')
      .eq('business_id', businessId)
      .maybeSingle();

    if (inventoryError) throw new Error('Inventory summary unavailable');

    // 3. Operational Context (Jobs)
    const { count: activeJobs, error: jobsError } = await supabase
      .from('jobs')
      .select('*', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .neq('status', 'Completed')
      .neq('status', 'Cancelled');

    if (jobsError) throw new Error('Job summary unavailable');

    return {
      financials: kpi[0] || { total_income: 0, total_expense: 0, net_profit: 0, transaction_count: 0 },
      inventory: inv || { total_skus: 0, total_asset_value: 0, low_stock_count: 0 },
      jobs: { activeCount: activeJobs || 0 }
    };
  }

  async getRevenueTrend(startDate: string, endDate: string, interval: 'day' | 'week' | 'month' = 'month') {
    if (!['day','week','month'].includes(interval)) throw new Error('Invalid revenue interval');
    const { supabase, businessId } = await this.getContext();
    if (!businessId) return [];

    if (await usesPythonAccounting()) {
      const data = await getAccountingSummary(startDate, endDate);
      const grouped = new Map<string, number>();
      for (const row of data.revenue_trend) {
        let period = interval === 'month' ? row.period.slice(0, 7) : row.period;
        if (interval === 'week') {
          const day = new Date(`${row.period}T00:00:00Z`);
          if (!Number.isFinite(day.getTime())) throw new Error('Revenue dates unavailable');
          day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
          period = day.toISOString().slice(0, 10);
        }
        grouped.set(period, (grouped.get(period) || 0) + Number(row.income));
      }
      return [...grouped].map(([period, income]) => ({ period, income }));
    }
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
    const data = await getAccountingSummary(startDate, endDate);
    return { income: data.income, expenses: data.expenses, netProfit: data.net_profit, categories: {} };

  }

  /**
   * Balance sheet comes from posted accounts, including actual liabilities and equity.
   */
  async getBalanceSheet() {
    const end = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
    const data = await getAccountingSummary(`${end.slice(0, 4)}-01-01`, end);
    return { assets: data.assets, liabilities: data.liabilities, equity: data.equity, difference: data.balance_sheet_difference };

  }
}
