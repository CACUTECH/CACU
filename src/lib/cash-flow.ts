export type CashFlowDetail = { ledger_id: number; transaction_id: number; transaction_no: string; date: string; account_id: string; account_name: string; description: string; amount: string };
export type CashFlowReport = { business_id: string; method: 'indirect'; currency: 'NGN'; timezone: string; start_date: string; end_date: string; sections: { key: string; lines: { label: string; amount: string; details: CashFlowDetail[] }[]; total: string }[]; net_change: string; opening_cash: string; fx_effect: string; closing_cash: string; ledger_cash: string; difference: string; reconciled: boolean; empty: boolean };

// Decimal strings stay exact even above JavaScript's safe integer range.
export function formatNgn(value: string): string {
  if (!/^-?\d+\.\d{2}$/.test(value)) throw new Error('Invalid monetary response');
  const negative = value.startsWith('-');
  const [whole, fraction] = value.replace('-', '').split('.');
  return `${negative ? '-' : ''}₦${BigInt(whole).toLocaleString('en-NG')}.${fraction}`;
}

export function cashFlowRows(report: CashFlowReport): string[][] {
  return [
    ['Statement of Cash Flows', 'NGN'], ['Method', report.method], ['Timezone', report.timezone],
    ['Start date', report.start_date], ['End date', report.end_date],
    ...report.sections.flatMap(section => [[section.key, ''], ...section.lines.map(line => [line.label, line.amount]), [`Total ${section.key}`, section.total]]),
    ['Net change in cash', report.net_change], ['Opening cash', report.opening_cash], ['FX effect', report.fx_effect],
    ['Closing cash', report.closing_cash], ['Ledger cash', report.ledger_cash], ['Reconciliation difference', report.difference],
    ['Reconciled', String(report.reconciled)],
  ];
}

export function reportCsv(report: CashFlowReport): string {
  return cashFlowRows(report).map(row => row.map(cell => {
    // Neutralize formula injection in account labels while preserving signed amounts.
    const safe = /^[=+@\t\r]/.test(cell) || (/^-/.test(cell) && !/^-?\d+\.\d{2}$/.test(cell)) ? `'${cell}` : cell;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n');
}
