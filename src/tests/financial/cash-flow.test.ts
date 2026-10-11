import { cashFlowRows, formatNgn, reportCsv, type CashFlowReport } from '@/lib/cash-flow';
import fixture from '../../../tests/browser/cash-flow-fixture.json';
const report = fixture as CashFlowReport;
test('preserves monetary cents above the JavaScript safe integer range', () => {
  expect(formatNgn('9999999999999.99')).toBe('₦9,999,999,999,999.99');
  expect(formatNgn('-75000.00')).toBe('-₦75,000.00');
});
test('screen and export share backend-calculated values', () => {
  expect(cashFlowRows(report)).toContainEqual(['Closing cash', report.closing_cash]);
  expect(reportCsv(report)).toContain('"Total operating","-75000.00"');
  expect(reportCsv(report)).toContain('"Reconciliation difference","0.00"');
});
test('neutralizes spreadsheet formulas in account names', () => {
  const manipulated: CashFlowReport = { ...report, sections: [{ key: 'operating', total: '0.00', lines: [{ label: '=1+2', amount: '0.00', details: [] }] }] };
  expect(reportCsv(manipulated)).toContain('"\'=1+2"');
});
