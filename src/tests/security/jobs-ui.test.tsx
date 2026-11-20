import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import JobPage from '@/app/jobs/[id]/page';
import POSPage from '@/app/pos/page';
import { billJobByInvoiceAction, completeJobAction, getJobMoneyAction } from '@/app/jobs/actions';
import { getCheckoutOptionsAction, processCheckoutAction } from '@/app/pos/actions';
import { getCollectionAccountsAction } from '@/app/accounting/collection-actions';
import { jobError, matchesJob } from '@/lib/jobs';

jest.mock('@/app/pos/offline-actions', () => ({ syncOfflineSaleAction: jest.fn(), offlineReviewAction: jest.fn(), decideOfflineSaleAction: jest.fn() }));
jest.mock('@/app/jobs/actions', () => ({ getJobMoneyAction: jest.fn(), completeJobAction: jest.fn(), billJobByInvoiceAction: jest.fn() }));
jest.mock('@/app/appointments/actions', () => ({ getBookingBillAction: jest.fn() }));
jest.mock('@/app/pos/actions', () => ({ getCheckoutOptionsAction: jest.fn(), processCheckoutAction: jest.fn() }));
jest.mock('@/app/pos/shift-actions', () => ({ getShiftAction: jest.fn().mockResolvedValue({ success: true, data: null }) }));
jest.mock('@/app/accounting/collection-actions', () => ({ getCollectionAccountsAction: jest.fn() }));
jest.mock('@/app/business-actions', () => ({ getActiveBusinessIdAction: jest.fn().mockResolvedValue('b1') }));
jest.mock('next/navigation', () => ({ useParams: () => ({ id: 'j1' }), useSearchParams: () => new URLSearchParams('job=j1') }));
const mockToast = { toast: jest.fn() };
jest.mock('@/hooks/use-toast', () => ({ useToast: () => mockToast }));
jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

// A small Data API stand-in: reads return each table's rows; writes are recorded and answered from mockDb.reply.
const mockDb: { rows: Record<string, unknown[]>; writes: { table: string; kind: string; value?: unknown }[]; reply: { data: unknown[] | null; error: { message: string; code?: string } | null } } =
  { rows: {}, writes: [], reply: { data: [{ id: 'x' }], error: null } };
jest.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: (table: string) => {
  let write: { table: string; kind: string; value?: unknown } | null = null;
  const chain: Record<string, unknown> = {};
  for (const step of ['select', 'order', 'limit', 'eq', 'in', 'gte', 'lte', 'lt']) chain[step] = () => chain;
  chain.insert = (value: unknown) => { write = { table, kind: 'insert', value }; return chain; };
  chain.update = (value: unknown) => { write = { table, kind: 'update', value }; return chain; };
  chain.delete = () => { write = { table, kind: 'delete' }; return chain; };
  chain.then = (resolve: (value: unknown) => void) => {
    if (write) { mockDb.writes.push(write); return resolve(mockDb.reply); }
    return resolve({ data: mockDb.rows[table] ?? [], error: null });
  };
  return chain;
} }) }));

jest.setTimeout(20000);
let keys = 0;
Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => `key-${++keys}` });
const job = { id: 'j1', number: 'JOB-0001', title: 'Hair and treatment', status: 'in_progress', customer_id: null, customer_name: 'Kemi', staff_id: null,
  description: null, due_date: null, cancel_reason: null, bill_kind: null, created_at: '2026-11-07T08:00:00Z' };
const money = { id: 'j1', number: 'JOB-0001', status: 'in_progress', bill_kind: null, bill_id: null, revenue: '16500.00', materials_cost: '1200.50', materials_issued: false,
  lines: [{ item_id: 'braids', name: 'Braids', kind: 'service', quantity: 1, unit_price: '15000.00', total: '15000.00' },
          { item_id: 'beans', name: 'Treatment oil', kind: 'material', quantity: 1, unit_price: '1500.00', total: '1500.00' }],
  profit: { labour_cost: '3000.00', profit: '12299.50', unrated_entries: 0 } };

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.writes = []; mockDb.reply = { data: [{ id: 'x' }], error: null };
  mockDb.rows = {
    jobs: [job], job_lines: [{ id: 'l1', catalog_item_id: 'braids', quantity: 1 }, { id: 'l2', catalog_item_id: 'beans', quantity: 1 }],
    job_labour: [{ id: 't1', staff_id: 'ada', minutes: 90, note: '' }],
    catalog_items: [{ id: 'braids', name: 'Braids', item_type: 'SERVICE', type: 'SERVICE', unit_price: 15000, price: 15000, stock_quantity: null, status: 'active' },
                    { id: 'beans', name: 'Treatment oil', item_type: 'PRODUCT', type: 'PRODUCT', unit_price: 1500, price: 1500, stock_quantity: 3, quantity: 3, status: 'active' },
                    { id: 'nails', name: 'Nails', item_type: 'SERVICE', type: 'SERVICE', unit_price: 5000, price: 5000, stock_quantity: null, status: 'active' }],
    service_staff: [{ id: 'ada', name: 'Ada' }], customers: [{ id: 'c1', name: 'Funmi' }], parked_sales: [],
  };
  (getJobMoneyAction as jest.Mock).mockResolvedValue({ success: true, data: money });
  (getCollectionAccountsAction as jest.Mock).mockResolvedValue({ native: true, accounts: [] });
  (getCheckoutOptionsAction as jest.Mock).mockResolvedValue({ discount_cap: '5', allow_oversell: false, refund_threshold: null });
});

test('job helpers explain refusals and check a till cart against the job', () => {
  expect(jobError({ message: 'JOB_CLOSED' })).toBe('This job is completed or cancelled and can no longer change.');
  expect(jobError({ message: 'dup', code: '23505' })).toBe('That item is already on the job. Change its quantity instead.');
  expect(matchesJob([{ id: 'a', quantity: 2 }], [{ item_id: 'a', quantity: 2 }])).toBe(true);
  expect(matchesJob([{ id: 'a', quantity: 1 }], [{ item_id: 'a', quantity: 2 }])).toBe(false);
});

test('a job gets a line, is completed so its materials leave stock, and shows its profit', async () => {
  (completeJobAction as jest.Mock).mockResolvedValue({ success: true, data: { ...money, status: 'completed', materials_issued: true } });
  render(<JobPage />);
  expect(await screen.findByRole('heading', { name: 'JOB-0001: Hair and treatment' })).toBeInTheDocument();
  expect(screen.getByText('Ada: 1h 30m')).toBeInTheDocument();
  expect(screen.getByText('Profit').nextSibling).toHaveTextContent('₦12,299.50');
  await userEvent.selectOptions(screen.getByLabelText('Service or material'), 'nails');
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(() => expect(mockDb.writes).toContainEqual({ table: 'job_lines', kind: 'insert', value: { business_id: 'b1', job_id: 'j1', catalog_item_id: 'nails', quantity: 1 } }));
  await userEvent.click(await screen.findByRole('button', { name: 'Complete job' }));
  expect(screen.getByText('These materials leave stock now, at their cost. The job can no longer change.')).toBeInTheDocument();
  expect(screen.getByRole('dialog')).toHaveTextContent('1 x Treatment oil');
  await userEvent.click(screen.getAllByRole('button', { name: 'Complete job' }).at(-1)!);
  await waitFor(() => expect(completeJobAction).toHaveBeenCalledWith('j1', expect.any(String)));
  expect(await screen.findByText('Job completed. Materials costing ₦1,200.50 left stock.')).toBeInTheDocument();
});

test('a completed job is paid at the till or billed by invoice to a chosen customer', async () => {
  mockDb.rows.jobs = [{ ...job, status: 'completed' }];
  (getJobMoneyAction as jest.Mock).mockResolvedValue({ success: true, data: { ...money, status: 'completed', materials_issued: true } });
  (billJobByInvoiceAction as jest.Mock).mockResolvedValue({ success: true, data: { job_id: 'j1', invoice_id: 'i1', invoice_number: 'JOB-0001', total: '16500.00' } });
  render(<JobPage />);
  expect(await screen.findByRole('link', { name: 'Take payment' })).toHaveAttribute('href', '/pos?job=j1');
  expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();  // completed jobs no longer change
  await userEvent.click(screen.getByRole('button', { name: 'Bill by invoice' }));
  await userEvent.selectOptions(screen.getByLabelText('Customer'), 'c1');
  await userEvent.click(screen.getByRole('button', { name: 'Issue invoice' }));
  await waitFor(() => expect(billJobByInvoiceAction).toHaveBeenCalledWith('j1', { requestKey: expect.any(String), customerId: 'c1' }));
  expect(await screen.findByText('Invoice JOB-0001 issued for ₦16,500.00.')).toBeInTheDocument();
});

test("the till opened from a job sells exactly the job's lines", async () => {
  (getJobMoneyAction as jest.Mock).mockResolvedValue({ success: true, data: { ...money, status: 'completed', materials_issued: true } });
  (processCheckoutAction as jest.Mock).mockResolvedValue({ success: true, saleId: 's1', status: 'completed', change: null, invoiceNumber: null, shortfalls: [] });
  render(<POSPage />);
  expect(await screen.findByText('Taking payment for JOB-0001.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'One more Treatment oil' }));
  await userEvent.click(screen.getByRole('button', { name: 'Complete Checkout' }));
  expect(screen.getByRole('alert')).toHaveTextContent("exactly the job's services and materials");
  await userEvent.keyboard('{Escape}');
  await userEvent.click(screen.getByRole('button', { name: 'One less Treatment oil' }));
  await userEvent.click(screen.getByRole('button', { name: 'Complete Checkout' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirm & Record Sale' }));
  await waitFor(() => expect(processCheckoutAction).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'j1', totalAmount: 16500 })));
});
