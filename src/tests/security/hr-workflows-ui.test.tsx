import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mutateHRAction } from '@/app/hr/actions';
import { HRService } from '@/services/hr-service';
import { AttendanceBoard } from '@/components/hr/attendance-board';
import { EmployeeStatusPanel } from '@/components/hr/employee-status-panel';
import { EmployeeForm } from '@/components/hr/employee-form';
import { PayrollRunActions } from '@/components/hr/payroll-controls';
import AttendancePage from '@/app/hr/attendance/page';
import PayrollRunPage from '@/app/hr/payroll/[id]/page';
import type { EmployeeRecord } from '@/lib/hr';
jest.mock('@/app/hr/actions', () => ({ mutateHRAction: jest.fn() }));
jest.mock('@/services/hr-service', () => ({ HRService: jest.fn() }));
const push = jest.fn(), refresh = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
const action = mutateHRAction as jest.Mock;
let keys = 0;
Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => `key-${++keys}` });
beforeEach(() => jest.clearAllMocks());

const staff = [{ id: 'e1', full_name: 'Ada Obi', job_title: 'Cashier', employment_status: 'active' },
  { id: 'e2', full_name: 'Bayo Ade', job_title: null, employment_status: 'on_leave' }];
const employee: EmployeeRecord = { id: 'e1', version: 4, full_name: 'Ada Obi', job_title: 'Cashier', department: null, email: null, phone: null,
  employment_status: 'active', start_date: '2026-01-05', end_date: null, departure_reason: null, pay_basic: '300000.00', pay_housing: '100000.00',
  pay_transport: '50000.00', pay_other: '0.00', annual_rent: '0.00', pension_enrolled: true, nhf_enrolled: false, nhis_monthly: '0.00', tax_id: null, pension_pin: null };

test('lost response keeps the original request key for retry', async () => {
  action.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ success: true, data: { id: 'shift' } });
  render(<AttendanceBoard staff={staff} records={[]} open={[]} isToday />);
  await userEvent.click(screen.getByRole('button', { name: 'Check in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('not confirmed');
  expect(screen.getByRole('button', { name: 'Check in' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Retry original change' }));
  await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
  expect(action.mock.calls[1][0]).toEqual(action.mock.calls[0][0]);
  expect(action.mock.calls[0][0]).toMatchObject({ operation: 'attendance.check_in', record_id: 'e1' });
  expect(await screen.findByRole('status')).toHaveTextContent('Ada Obi checked in.');
  expect(refresh).toHaveBeenCalled();
});
test('definite failures release the request and show the reviewed message', async () => {
  action.mockResolvedValue({ success: false, error: 'This employee is already checked in.', uncertain: false });
  render(<AttendanceBoard staff={staff} records={[]} open={[]} isToday />);
  await userEvent.click(screen.getByRole('button', { name: 'Check in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('already checked in');
  expect(screen.queryByRole('button', { name: 'Retry original change' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Check in' }));
  expect(action.mock.calls[1][0].request_key).not.toBe(action.mock.calls[0][0].request_key);
});
test('only active staff can check in; past days offer no check-in', () => {
  const { rerender } = render(<AttendanceBoard staff={staff} records={[]} open={[]} isToday />);
  expect(screen.getAllByRole('button', { name: 'Check in' })).toHaveLength(1);
  rerender(<AttendanceBoard staff={staff} records={[]} open={[{ id: 's', employee_id: 'e1', check_in: '2026-10-27T08:00:00Z', work_date: '2026-10-27' }]} isToday={false} />);
  expect(screen.queryByRole('button', { name: 'Check in' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Check out' })).toBeInTheDocument();
  expect(screen.getByText('Open since 2026-10-27')).toBeInTheDocument();
});
test('departure needs a reason and an explicit confirmation', async () => {
  action.mockResolvedValue({ success: true, data: {} });
  render(<EmployeeStatusPanel employee={employee} today="2026-10-29" />);
  await userEvent.click(screen.getByRole('button', { name: 'Record departure' }));
  expect(screen.getByRole('alert')).toHaveTextContent('reason');
  await userEvent.type(screen.getByRole('textbox'), 'Resigned');
  await userEvent.click(screen.getByRole('button', { name: 'Record departure' }));
  expect(action).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Confirm departure of Ada Obi' }));
  await waitFor(() => expect(action).toHaveBeenCalledWith(expect.objectContaining({ operation: 'employee.depart', record_id: 'e1', expected_version: 4,
    details: { end_date: '2026-10-29', reason: 'Resigned' } })));
});
test('employee form sends the version and shows monthly gross', async () => {
  action.mockResolvedValue({ success: true, data: { id: 'e1', version: 5 } });
  render(<EmployeeForm employee={employee} />);
  expect(screen.getByText('₦450,000.00')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(action).toHaveBeenCalledWith(expect.objectContaining({ operation: 'employee.save', record_id: 'e1', expected_version: 4,
    details: expect.objectContaining({ pay_basic: '300000.00', pension_enrolled: true, start_date: '2026-01-05' }) })));
  expect(push).not.toHaveBeenCalled();
});
test('invalid amounts are caught before sending', async () => {
  render(<EmployeeForm />);
  await userEvent.type(screen.getByRole('textbox', { name: 'Full name' }), 'New hire');
  await userEvent.type(screen.getByRole('textbox', { name: 'Basic (₦)' }), '100.555');
  await userEvent.click(screen.getByRole('button', { name: 'Add employee' }));
  expect(screen.getByRole('alert')).toHaveTextContent('two decimal places');
  expect(action).not.toHaveBeenCalled();
});
test('approval is blocked on unreviewed rules and needs confirmation otherwise', async () => {
  const { rerender } = render(<PayrollRunActions id="run" version={1} reviewed={false} />);
  expect(screen.getByRole('button', { name: 'Approve payroll' })).toBeDisabled();
  rerender(<PayrollRunActions id="run" version={1} reviewed />);
  action.mockResolvedValue({ success: true, data: { status: 'approved' } });
  await userEvent.click(screen.getByRole('button', { name: 'Approve payroll' }));
  expect(action).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Confirm approval (cannot be undone)' }));
  await waitFor(() => expect(action).toHaveBeenCalledWith(expect.objectContaining({ operation: 'payroll.approve', record_id: 'run', expected_version: 1 })));
});
test.each(['2026-02-30', '2999-01-01', ['2026-01-01']])('attendance page rejects date %p without querying', async date => {
  render(await AttendancePage({ searchParams: Promise.resolve({ date }) }));
  expect(screen.getByRole('alert')).toHaveTextContent('valid date');
  expect(HRService).not.toHaveBeenCalled();
});
test('payroll run page lists payslips, totals and excluded staff', async () => {
  const slip = (name: string, net: string) => ({ id: name, employee_name: name, job_title: null, chargeable_annual: '0', gross: '500000', pension_employee: '36000',
    nhf: '0', nhis: '0', paye: '62420', net, pension_employer: '45000' });
  (HRService as jest.Mock).mockImplementation(() => ({ payrollRun: jest.fn().mockResolvedValue({
    run: { id: 'run', version: 1, period: '2026-10-01', status: 'approved', created_at: '2026-10-28T10:00:00Z', approved_at: '2026-10-28T11:00:00Z', rules: { source: 'NTA' }, rules_reviewed_at: '2026-10-28T09:00:00Z',
      excluded: [{ id: 'x', name: 'Legacy employee', reason: 'No pay structure' }] },
    payslips: [slip('Ada', '401580'), slip('Bayo', '401580')] }) }));
  render(await PayrollRunPage({ params: Promise.resolve({ id: 'run' }) }));
  expect(screen.getByRole('heading', { name: /October 2026 payroll/ })).toBeInTheDocument();
  expect(screen.getByText('Total (2)')).toBeInTheDocument();
  expect(screen.getByText('₦803,160.00')).toBeInTheDocument();
  expect(screen.getByText(/No pay structure/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Approve payroll' })).not.toBeInTheDocument();
});
