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


test('cash-component restrictions and financing changes are included in exports',() => {
  const noted:CashFlowReport={...report,cash_components:[{account_id:'bank',name:'Restricted demand deposit',opening:'100.00',closing:'160.00',restricted:true}],financing_reconciliation:[{account_id:'loan',name:'Loan',opening:'0.00',cash_movements:'60.00',noncash_movements:'0.00',closing:'60.00'}]};
  expect(cashFlowRows(noted)).toContainEqual(['Restricted: Restricted demand deposit','true']);
  expect(cashFlowRows(noted)).toContainEqual(['Cash movements','60.00']);
});
