import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PayslipLinks } from '@/components/hr/payslip-links';
import PublicPayslipPage from '@/app/payslip/[token]/page';
import { sharePayslipAction, withdrawPayslipLinkAction } from '@/app/hr/actions';
import { whatsappHref } from '@/lib/payslips';

const TOKEN = 'a'.repeat(64);
const mockRpc = jest.fn();
let mockToken = TOKEN;
jest.mock('@/app/hr/actions', () => ({ sharePayslipAction: jest.fn(), withdrawPayslipLinkAction: jest.fn() }));
jest.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: mockRpc }) }));
jest.mock('next/navigation', () => ({ useParams: () => ({ token: mockToken }) }));

const ADA = '7d3c9a57-1b0e-4c64-9a52-5e1f4f2f0a11', BISI = '0b9b3f0e-2d8a-4f6c-8a43-6f2b1d7a9c10';
const slips = [{ id: ADA, employee_name: 'Ada Obi' }, { id: BISI, employee_name: 'Bisi Ade' }];
const live = { payslip_id: BISI, shared_at: '2026-11-20T10:00:00Z', expires_at: '2026-12-20T10:00:00Z', expired: false, open_count: 2, last_opened_at: '2026-11-21T08:00:00Z' };

beforeEach(() => { jest.clearAllMocks(); mockToken = TOKEN; });

test('a link is made for the chosen days, shown once, and can be withdrawn', async () => {
  (sharePayslipAction as jest.Mock).mockResolvedValue({ success: true, data: { token: TOKEN, payslip_id: ADA, expires_at: '2026-12-03T10:00:00Z' } });
  (withdrawPayslipLinkAction as jest.Mock).mockResolvedValue({ success: true });
  render(<PayslipLinks period="November 2026" payslips={slips} links={[live]} />);
  expect(screen.getByText('Not shared')).toBeInTheDocument();
  expect(screen.getByText(/opened 2 times/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Links work for'), { target: { value: '7' } });
  fireEvent.click(screen.getByRole('button', { name: 'Share link' }));
  await waitFor(() => expect(screen.getByLabelText(/Link for Ada Obi/)).toHaveValue(`http://localhost/payslip/${TOKEN}`));
  expect(sharePayslipAction).toHaveBeenCalledWith(ADA, 7);
  expect(screen.getByRole('link', { name: 'Send on WhatsApp' })).toHaveAttribute('href', whatsappHref('Ada Obi', 'November 2026', `http://localhost/payslip/${TOKEN}`));
  fireEvent.click(screen.getAllByRole('button', { name: 'Withdraw' })[0]);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent("Ada Obi's link no longer works."));
  expect(withdrawPayslipLinkAction).toHaveBeenCalledWith(ADA);
  expect(screen.queryByLabelText(/Link for Ada Obi/)).not.toBeInTheDocument();
});

test('the employee sees their payslip; a bad or withdrawn link shows nothing', async () => {
  mockRpc.mockResolvedValue({ error: null, data: { business: { name: 'Mama Ada Provisions', address: null }, period: '2026-11-01',
    employee: { name: 'Ada Obi', job_title: 'Cashier', tax_id: '••••7890', pension_pin: '••••0400', pfa: 'ARM Pension Managers', tax_state: 'Lagos' },
    earnings: { basic: 300000, housing: 100000, transport: 50000, other: 50000, gross: 500000 }, deductions: { paye: 62420, pension: 36000, nhf: 0, nhis: 0 },
    net: 401580, employer_pension: 45000, taxable_annual: 5328000, approved_at: '2026-11-25T10:00:00Z', expires_at: '2026-12-25T10:00:00Z' } });
  const first = render(<PublicPayslipPage />);
  expect(await screen.findByRole('article', { name: 'Payslip' })).toHaveTextContent('Net pay₦401,580.00');
  expect(screen.getByText('••••7890')).toBeInTheDocument();
  expect(screen.queryByText('National Housing Fund')).not.toBeInTheDocument();
  expect(mockRpc).toHaveBeenCalledWith('public_payslip', { p_token: TOKEN });
  first.unmount();
  mockRpc.mockResolvedValue({ error: null, data: null });
  const second = render(<PublicPayslipPage />);
  expect(await screen.findByRole('heading', { name: 'Payslip not available' })).toBeInTheDocument();
  second.unmount();
  mockRpc.mockClear(); mockToken = 'not-a-token';
  render(<PublicPayslipPage />);
  expect(await screen.findByRole('heading', { name: 'Payslip not available' })).toBeInTheDocument();
  expect(mockRpc).not.toHaveBeenCalled();
});
