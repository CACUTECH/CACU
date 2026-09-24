
import { BaseService } from './base-service';

/**
 * @fileOverview ReportService provides aggregated financial intelligence.
 * Leverages PostgreSQL grouping and summing for high-performance analytics.
 */
export class ReportService extends BaseService {
  async getProfitAndLoss(startDate: string, endDate: string) {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) throw new Error('Business context missing');

    const { data, error } = await supabase
      .from('financial_transactions')
      .select('type, amount, category')
      .eq('business_id', businessId)
      .gte('date', startDate)
      .lte('date', endDate);

    if (error) throw error;

    const report = {
      income: 0,
      expenses: 0,
      netProfit: 0,
      categories: {} as Record<string, number>
    };

    data?.forEach(tx => {
      if (tx.type === 'Income') {
        report.income += Number(tx.amount);
      } else {
        report.expenses += Number(tx.amount);
      }

      if (!report.categories[tx.category]) report.categories[tx.category] = 0;
      report.categories[tx.category] += (tx.type === 'Income' ? 1 : -1) * Number(tx.amount);
    });

    report.netProfit = report.income - report.expenses;
    return report;
  }

  async getBalanceSheet() {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) throw new Error('Business context missing');

    // Basic Balance Sheet simulation from current account balances in catalog (inventory value) 
    // and ledger (cash position)
    const [invRes, txRes] = await Promise.all([
      supabase.from('catalog_items').select('price, quantity').eq('business_id', businessId).eq('type', 'Product'),
      supabase.from('financial_transactions').select('type, amount').eq('business_id', businessId)
    ]);

    const inventoryValue = invRes.data?.reduce((acc, curr) => acc + (Number(curr.price) * (curr.quantity || 0)), 0) || 0;
    const cashBalance = txRes.data?.reduce((acc, curr) => acc + (curr.type === 'Income' ? 1 : -1) * Number(curr.amount), 0) || 0;

    return {
      assets: {
        cash: cashBalance,
        inventory: inventoryValue,
        total: cashBalance + inventoryValue
      },
      liabilities: {
        accountsPayable: 0, // In production, fetch from bills
        total: 0
      },
      equity: {
        retainedEarnings: cashBalance + inventoryValue,
        total: cashBalance + inventoryValue
      }
    };
  }
}
