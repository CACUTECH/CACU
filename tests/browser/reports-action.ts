import type { FinancialStatements } from '../../src/lib/ledger-reports';

// Browser test double for src/app/reports/actions.ts.
const calls: unknown[][] = [];
const section = (key: string, title: string, lines: [string, string, string[]][]) => ({ key, title,
  lines: lines.map(([code, name, amounts]) => ({ account_id: code, code, name, amounts })),
  total: lines[0] ? lines[0][2].map((_, i) => lines.reduce((sum, l) => sum + Number(l[2][i]), 0).toFixed(2)) : [] });

export async function getStatementsAction(start: string, end: string, compare: 'prior' | 'last_year' | ''): Promise<{ success: true; data: FinancialStatements } | { success: false; error: string }> {
  calls.push([start, end, compare]); (window as unknown as { statementCalls: unknown[][] }).statementCalls = calls;
  const two = compare !== '';
  const v = (current: string, prior: string) => two ? [current, prior] : [current];
  const periods = [{ start_date: start, end_date: end }, ...(two ? [{ start_date: '2026-09-01', end_date: '2026-09-30' }] : [])];
  return { success: true, data: { tier: 'Management statements, not reviewed', basis: 'Accrual', currency: 'NGN', generated_at: '2026-11-01T10:00:00+01:00',
    periods, compare: compare || null,
    exceptions: two ? [{ check: 'financial_position', message: 'Assets do not equal liabilities and equity at the end of the comparison period' }] : [],
    income_statement: { sections: [section('revenue', 'Revenue', [['4000', 'Sales of goods', v('65000.00', '40000.00')]]),
      section('cost_of_sales', 'Cost of sales', [['5000', 'Cost of goods sold', v('50000.00', '30000.00')]]),
      section('operating_expenses', 'Operating expenses', [['6200', 'Utilities and power (including diesel)', v('15000.00', '0.00')]]),
      section('other_income', 'Other income', []), section('other_expenses', 'Other expenses', [])],
      gross_profit: v('15000.00', '10000.00'), net_profit: v('0.00', '10000.00') },
    financial_position: { sections: [section('current_assets', 'Current assets', [['1000', 'Cash on hand', v('10000.00', '5000.00')]]),
      section('non_current_assets', 'Non-current assets', []), section('current_liabilities', 'Current liabilities', []),
      section('non_current_liabilities', 'Non-current liabilities', []), section('equity', 'Equity', [['3000', 'Capital', v('10000.00', '4000.00')]])],
      total_assets: v('10000.00', '5000.00'), total_liabilities: v('0.00', '0.00'), total_equity: v('10000.00', '4000.00'), difference: v('0.00', '1000.00') } } };
}
