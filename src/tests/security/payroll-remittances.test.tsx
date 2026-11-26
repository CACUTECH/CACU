import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { buildSchedules, csvCell, payeCsv, pensionCsv, type RemittanceSchedule, type SchedulePayslip } from '@/lib/remittances';
import { RemittanceSchedules } from '@/components/hr/remittance-schedules';
import { RemittanceDetailsForm } from '@/components/hr/remittance-details-form';
import { saveRemittanceDetailsAction } from '@/app/hr/actions';

jest.mock('@/app/hr/actions', () => ({ saveRemittanceDetailsAction: jest.fn() }));

const slip = (over: Partial<SchedulePayslip>): SchedulePayslip => ({ employee_id: over.name ?? 'x', name: 'Ada Obi', tax_id: '1234567890', pension_pin: 'PEN100',
  tax_state: 'Lagos', pfa: 'Stanbic IBTC Pension Managers', gross: 500000, taxable_monthly: 444000, paye: 62420, pension_employee: 36000,
  pension_employer: 45000, nhf: 0, nhis: 0, ...over });
const schedule: RemittanceSchedule = { run: { id: 'r1', period: '2026-11-01', employee_count: 3 },
  payslips: [slip({}), slip({ name: 'Bisi Ade', tax_state: 'Ogun', paye: 10000.1, nhf: 5000 }),
    slip({ name: 'Chidi Eze', tax_state: null, tax_id: null, pfa: null, pension_pin: null, paye: 20000.2 }),
    slip({ name: 'Dayo Low', tax_state: 'Lagos', paye: 0, pension_employee: 0, pension_employer: 0 })],
  totals: { paye: 92420.3, pension: 243000, nhf: 5000, nhis: 0 } };

beforeEach(() => jest.clearAllMocks());

test('PAYE groups by state and pension by PFA, unset ones last; totals are exact to the kobo', () => {
  const s = buildSchedules(schedule);
  expect(s.paye.map(g => [g.to, g.rows.length, g.total])).toEqual([['Lagos', 2, 62420], ['Ogun', 1, 10000.1], [null, 1, 20000.2]]);
  expect(s.pension.map(g => [g.to, g.rows.length, g.total])).toEqual([['Stanbic IBTC Pension Managers', 2, 162000], [null, 1, 81000]]);
  expect(s.nhf.map(r => r.name)).toEqual(['Bisi Ade']);
  expect(s.missing).toEqual({ tax_state: ['Chidi Eze'], tax_id: ['Chidi Eze'], pfa: ['Chidi Eze'], pension_pin: ['Chidi Eze'] });  // Dayo has no pension
});

test('CSV cells are quoted and never run as spreadsheet formulas', () => {
  expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
  expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
  expect(csvCell('-100.00')).toBe('"-100.00"');  // a number stays a number
  expect(csvCell(null)).toBe('""');
  const lagos = buildSchedules(schedule).paye[0];
  expect(payeCsv('2026-11', lagos).split('\r\n')).toEqual([
    '"Period","State","Employee","Tax ID","Gross pay","Taxable pay (monthly)","PAYE"',
    '"2026-11","Lagos","Ada Obi","1234567890","500000.00","444000.00","62420.00"',
    '"2026-11","Lagos","Dayo Low","1234567890","500000.00","444000.00","0.00"',
    '"2026-11","Lagos","Total","","","","62420.00"', '']);
  expect(pensionCsv('2026-11', buildSchedules(schedule).pension[1]).split('\r\n')[1]).toBe('"2026-11","PFA not set","Chidi Eze","","36000.00","45000.00","81000.00"');
});

test('the run page lists each schedule with a download, and says who is missing details', () => {
  render(<RemittanceSchedules schedule={schedule} />);
  expect(screen.getByRole('note')).toHaveTextContent('State taxed in not set for Chidi Eze: their PAYE cannot be sent to a state.');
  expect(screen.getByRole('region', { name: 'PAYE by state' })).toHaveTextContent('Lagos · 2 staff · ₦62,420.00');
  expect(screen.getByRole('region', { name: 'Pension by PFA' })).toHaveTextContent('PFA not set · 1 staff · ₦81,000.00');
  expect(screen.getByRole('region', { name: 'NHF' })).toHaveTextContent('₦5,000.00');
  expect(screen.queryByRole('region', { name: 'NHIS' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Download CSV' })).toHaveLength(6);
});

test('an employee’s state and PFA are saved through the audited action', async () => {
  (saveRemittanceDetailsAction as jest.Mock).mockResolvedValue({ success: true, data: { tax_state: 'Ogun', pfa: 'ARM Pension Managers' } });
  render(<RemittanceDetailsForm employeeId="e1" details={{ tax_state: null, pfa: null }} />);
  fireEvent.change(screen.getByLabelText('State taxed in'), { target: { value: 'Ogun' } });
  fireEvent.change(screen.getByLabelText('Pension Fund Administrator'), { target: { value: ' ARM Pension Managers ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved.'));
  expect(saveRemittanceDetailsAction).toHaveBeenCalledWith('e1', { tax_state: 'Ogun', pfa: 'ARM Pension Managers' });
});
