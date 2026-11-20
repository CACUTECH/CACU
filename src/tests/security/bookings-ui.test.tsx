import '@testing-library/jest-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppointmentsPage from '@/app/appointments/page';
import { addDays, bookingError, freeSlots, isoWeekday, lagosDay, lagosInstant, lagosTime, serviceMinutes, type Booking } from '@/lib/bookings';
import { lagosToday } from '@/lib/transfers';
import BookingSettingsPage from '@/app/appointments/settings/page';
import { closeBookingAction, getBookingMoneyAction, getBookingSettingsAction, saveBookingSettingsAction, takeDepositAction } from '@/app/appointments/actions';
import { expectedDepositKobo, freeToCancel } from '@/lib/bookings';

jest.mock('@/app/appointments/actions', () => ({ getBookingMoneyAction: jest.fn(), getBookingSettingsAction: jest.fn(), saveBookingSettingsAction: jest.fn(),
  takeDepositAction: jest.fn(), closeBookingAction: jest.fn() }));
jest.mock('@/app/accounting/collection-actions', () => ({ getCollectionAccountsAction: jest.fn().mockResolvedValue({ native: true, accounts: [{ id: 'gtb', name: 'GTBank' }] }) }));
jest.mock('@/app/business-actions', () => ({ getActiveBusinessIdAction: jest.fn().mockResolvedValue('b1') }));
jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

// A small Data API stand-in: reads return each table's rows; writes are recorded and answered from mockDb.reply.
const mockDb: { rows: Record<string, unknown[]>; writes: { table: string; kind: string; value: unknown; id?: string }[];
  reply: { data: unknown[] | null; error: { message: string; code?: string } | null } } = { rows: {}, writes: [], reply: { data: [{ id: 'new' }], error: null } };
jest.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: (table: string) => {
  let write: { table: string; kind: string; value: unknown; id?: string } | null = null;
  const chain: Record<string, unknown> = {};
  for (const step of ['select', 'order', 'limit', 'gte', 'lte', 'lt']) chain[step] = () => chain;
  chain.eq = (column: string, value: string) => { if (write && column === 'id') write.id = value; return chain; };
  chain.insert = (value: unknown) => { write = { table, kind: 'insert', value }; return chain; };
  chain.update = (value: unknown) => { write = { table, kind: 'update', value }; return chain; };
  chain.then = (resolve: (value: unknown) => void) => {
    if (write) { mockDb.writes.push(write); return resolve(mockDb.reply); }
    return resolve({ data: mockDb.rows[table] ?? [], error: null });
  };
  return chain;
} }) }));

jest.setTimeout(20000);
const today = lagosToday();
const tomorrow = addDays(today, 1);
const booking = (over: Partial<Booking>): Booking => ({ id: 'bk-1', staff_id: 'ada', service_id: 'braids', scheduled_at: lagosInstant(today, '10:00'),
  ends_at: lagosInstant(today, '10:45'), duration_minutes: 45, title: 'Braids', status: 'confirmed', customer_id: null, customer_name: 'Funmi',
  customer_phone: '0803', notes: null, cancel_reason: null, ...over });

let keys = 0;
Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => `key-${++keys}` });
const settings = { free_cancel_hours: 24, late_deposit: 'keep', deposits_ready: true, rules: [{ service_id: 'braids', kind: 'percent', value: '20.00' }] };

beforeEach(() => {
  jest.clearAllMocks();
  (getBookingMoneyAction as jest.Mock).mockResolvedValue({ success: true, data: null });  // books not on unless a test says so
  mockDb.writes = []; mockDb.reply = { data: [{ id: 'new' }], error: null };
  mockDb.rows = {
    service_staff: [{ id: 'ada', name: 'Ada', is_active: true }, { id: 'bisi', name: 'Bisi', is_active: true }],
    catalog_items: [{ id: 'braids', name: 'Braids', duration: 45, unit_price: 15000 }],
    service_staff_services: [{ staff_id: 'ada', service_id: 'braids' }],
    service_staff_hours: [], service_staff_time_off: [], customers: [],
    appointments: [booking({ scheduled_at: lagosInstant(tomorrow, '10:00'), ends_at: lagosInstant(tomorrow, '10:45') })],
  };
});

test('Lagos times, weekdays and durations match the database', () => {
  expect(lagosInstant('2026-11-09', '09:30')).toBe('2026-11-09T09:30:00+01:00');
  expect([lagosDay('2026-11-09T23:30:00Z'), lagosTime('2026-11-09T23:30:00Z')]).toEqual(['2026-11-10', '00:30']);
  expect([isoWeekday('2026-11-09'), isoWeekday('2026-11-15')]).toEqual([1, 7]);
  expect([serviceMinutes({ duration: 45 }), serviceMinutes({ duration: null }), serviceMinutes({ duration: 0 })]).toEqual([45, 60, 60]);
});

test('free times stay inside working hours and clear of bookings, time off and the past', () => {
  const day = '2026-11-09';  // a Monday
  const hours = [{ staff_id: 'ada', weekday: 1, starts: '09:00:00', ends: '13:00:00' }, { staff_id: 'ada', weekday: 1, starts: '14:00:00', ends: '15:00:00' }];
  const now = new Date('2026-11-01T00:00:00Z');
  const taken = [booking({ scheduled_at: lagosInstant(day, '10:00'), ends_at: lagosInstant(day, '10:45') }),
                 booking({ id: 'gone', status: 'cancelled', scheduled_at: lagosInstant(day, '09:00'), ends_at: lagosInstant(day, '09:45') })];
  const timeOff = [{ id: 't', staff_id: 'ada', starts_at: lagosInstant(day, '11:45'), ends_at: lagosInstant(day, '12:15'), reason: '' }];
  const slots = freeSlots({ day, duration: 45, staffId: 'ada', hours, timeOff, bookings: taken, now, step: 15 });
  expect(slots).toEqual(['09:00', '09:15', '10:45', '11:00', '12:15', '14:00', '14:15']);
  expect(freeSlots({ day, duration: 45, staffId: 'ada', hours, timeOff, bookings: taken, now, except: 'bk-1' })).toContain('10:00');  // rescheduling frees its own time
  expect(freeSlots({ day: '2026-11-15', duration: 45, staffId: 'ada', hours, timeOff: [], bookings: [], now })).toEqual([]);  // Sunday off
  expect(freeSlots({ day, duration: 60, staffId: 'bisi', hours, timeOff: [], bookings: [], now, step: 60 })[0]).toBe('07:00');  // no hours set
  expect(freeSlots({ day, duration: 45, staffId: 'ada', hours, timeOff: [], bookings: [], now: new Date(lagosInstant(day, '12:00')) })).toEqual(['12:00', '12:15', '14:00', '14:15']);
});

test('database refusals read in plain words', () => {
  expect(bookingError({ message: 'BOOKING_OVERLAP' })).toBe('That time is already booked for this staff member. Choose another time.');
  expect(bookingError({ message: 'new row violates row-level security policy', code: '42501' })).toBe('You do not have permission to do this. Ask the business owner.');
  expect(bookingError({ message: 'duplicate key', code: '23505' })).toBe('Someone with that name is already on your staff list.');
  expect(bookingError({ message: 'boom' })).toBe('The booking was not saved. Refresh and try again.');
});

test('a booking is made for a free time with a walk-in customer, and an overlap is explained', async () => {
  render(<AppointmentsPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Next day' }));
  const ada = await screen.findByRole('list', { name: "Ada's bookings" });
  expect(within(ada).getByText('10:00–10:45 Braids')).toBeInTheDocument();
  expect(screen.getAllByText('Nothing booked.')).toHaveLength(1);  // Bisi
  await userEvent.click(screen.getByRole('button', { name: 'New booking' }));
  expect(screen.getByLabelText('Staff')).toHaveValue('ada');  // only Ada does braids
  const times = screen.getByRole('radiogroup', { name: 'Start time' });
  expect(within(times).queryByRole('radio', { name: '10:00' })).not.toBeInTheDocument();
  await userEvent.click(within(times).getByRole('radio', { name: '11:00' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Choose a customer or type their name.');
  await userEvent.type(screen.getByLabelText('Customer name'), 'Kemi');
  mockDb.reply = { data: null, error: { message: 'BOOKING_OVERLAP', code: '23P01' } };
  await userEvent.click(screen.getByRole('button', { name: 'Book' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('already booked for this staff member');
  mockDb.reply = { data: [{ id: 'new' }], error: null };
  await userEvent.click(screen.getByRole('button', { name: 'Book' }));
  expect(await screen.findByText(`Booked for 11:00 on ${tomorrow} with Ada.`)).toBeInTheDocument();
  expect(mockDb.writes.at(-1)).toEqual({ table: 'appointments', kind: 'insert', value: { business_id: 'b1', staff_id: 'ada', service_id: 'braids',
    scheduled_at: lagosInstant(tomorrow, '11:00'), title: '', customer_id: null, customer_name: 'Kemi', customer_phone: null, notes: null } });
});

test('checking in needs permission, and cancelling needs a reason', async () => {
  render(<AppointmentsPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Next day' }));
  await screen.findByRole('list', { name: "Ada's bookings" });
  mockDb.reply = { data: [], error: null };  // row security hid the change
  await userEvent.click(screen.getByRole('button', { name: 'Check in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission to change bookings');
  mockDb.reply = { data: [{ id: 'bk-1' }], error: null };
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  const cancel = screen.getByRole('button', { name: 'Cancel booking' });
  expect(cancel).toBeDisabled();
  await userEvent.type(screen.getByLabelText('Reason'), 'Customer travelled');
  await userEvent.click(cancel);
  await waitFor(() => expect(mockDb.writes.at(-1)).toEqual({ table: 'appointments', kind: 'update', id: 'bk-1', value: { status: 'cancelled', cancel_reason: 'Customer travelled' } }));
  expect(await screen.findByText('Funmi: cancelled.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'No-show' })).not.toBeInTheDocument();  // not before the start time
});

test('deposits follow the service rule and the free-cancellation window', () => {
  expect(expectedDepositKobo({ kind: 'percent', value: '20' }, 15000)).toBe(300000);
  expect(expectedDepositKobo({ kind: 'percent', value: '33.33' }, 100)).toBe(3333);
  expect(expectedDepositKobo({ kind: 'fixed', value: '20000' }, 15000)).toBe(1500000);  // never more than the price
  expect(expectedDepositKobo(undefined, 15000)).toBe(0);
  const now = new Date('2026-11-09T08:00:00Z');
  expect(freeToCancel('2026-11-10T08:00:00Z', 24, now)).toBe(true);
  expect(freeToCancel('2026-11-10T07:59:00Z', 24, now)).toBe(false);
});

test('with the books on, a deposit is taken by transfer and a late cancellation keeps it unless changed', async () => {
  (getBookingMoneyAction as jest.Mock).mockResolvedValue({ success: true, data: { settings, deposits: [] } });
  (takeDepositAction as jest.Mock).mockResolvedValueOnce({ success: false, error: 'The change was not confirmed. Refresh before trying again.', uncertain: true })
    .mockResolvedValueOnce({ success: true, data: { id: 'd1', appointment_id: 'bk-1', amount: '3000.00', method: 'transfer', status: 'awaiting_transfer' } });
  render(<AppointmentsPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Next day' }));
  expect(await screen.findByText('Deposit due: ₦3,000.00')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Take deposit' }));
  expect(screen.getByLabelText('Amount (₦)')).toHaveValue('3000.00');
  await userEvent.click(screen.getByRole('radio', { name: 'Bank transfer' }));
  await userEvent.click(screen.getAllByRole('button', { name: 'Take deposit' }).at(-1)!);
  expect(await screen.findByRole('alert')).toHaveTextContent('not confirmed');
  await userEvent.click(screen.getAllByRole('button', { name: 'Take deposit' }).at(-1)!);
  expect(await screen.findByText('Deposit of ₦3,000.00 recorded. The transfer waits for confirmation on Daily reconciliation.')).toBeInTheDocument();
  const [[, first], [, second]] = (takeDepositAction as jest.Mock).mock.calls;
  expect(first).toEqual({ requestKey: second.requestKey, amount: '3000.00', method: 'Transfer', bankAccountId: undefined });

  // The deposit is now held, and a 30-day window makes cancelling tomorrow's booking late.
  (getBookingMoneyAction as jest.Mock).mockResolvedValue({ success: true, data: { settings: { ...settings, free_cancel_hours: 720 },
    deposits: [{ id: 'd1', appointment_id: 'bk-1', amount: '3000.00', method: 'cash', status: 'held', received_on: today, settled_on: null, bank_account_id: null }] } });
  (closeBookingAction as jest.Mock).mockResolvedValue({ success: true, data: { id: 'bk-1', status: 'cancelled', deposit: 'keep', deposit_amount: '3000.00' } });
  await userEvent.click(screen.getByRole('button', { name: 'Previous day' }));
  await userEvent.click(screen.getByRole('button', { name: 'Next day' }));
  expect(await screen.findByText('Deposit ₦3,000.00 in cash: held')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText(/Cancelled late: your rule is to keep the ₦3,000.00 deposit/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('radio', { name: 'Refund deposit' }));
  expect(screen.getByText('Going against your rule needs someone who can approve sales.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('radio', { name: 'Keep deposit' }));
  await userEvent.type(screen.getByLabelText('Reason'), 'Customer travelled');
  await userEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
  await waitFor(() => expect(closeBookingAction).toHaveBeenCalledWith('bk-1', 'cancel', { requestKey: expect.any(String), reason: 'Customer travelled', deposit: 'keep' }));
  expect(await screen.findByText('Booking cancelled. The ₦3,000.00 deposit is kept as income.')).toBeInTheDocument();
});

test('the owner sets a deposit per service and the cancellation rule', async () => {
  (getBookingSettingsAction as jest.Mock).mockResolvedValue({ success: true, data: { ...settings, deposits_ready: false, rules: [] } });
  (saveBookingSettingsAction as jest.Mock).mockResolvedValue({ success: true, data: settings });
  render(<BookingSettingsPage />);
  await userEvent.selectOptions(await screen.findByLabelText('Deposit for Braids'), 'percent');
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a deposit above zero for Braids, at most 100%.');
  await userEvent.type(screen.getByLabelText('Braids deposit (%)'), '20');
  expect(screen.getByText('= ₦3,000.00')).toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText('Free cancellation hours'));
  await userEvent.type(screen.getByLabelText('Free cancellation hours'), '12');
  await userEvent.click(screen.getByRole('radio', { name: 'Refund the deposit' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(saveBookingSettingsAction).toHaveBeenCalledWith({ freeCancelHours: 12, lateDeposit: 'refund', rules: [{ serviceId: 'braids', kind: 'percent', value: '20' }] });
  expect(await screen.findByText('Saved. Customer deposits and advances was added to your chart of accounts to hold deposits.')).toBeInTheDocument();
});

test('before the books are on, deposits are explained', async () => {
  (getBookingSettingsAction as jest.Mock).mockResolvedValue({ success: true, data: null });
  render(<BookingSettingsPage />);
  expect(await screen.findByText('Deposits are available once your books are turned on.')).toBeInTheDocument();
});
