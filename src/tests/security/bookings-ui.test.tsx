import '@testing-library/jest-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppointmentsPage from '@/app/appointments/page';
import { addDays, bookingError, freeSlots, isoWeekday, lagosDay, lagosInstant, lagosTime, serviceMinutes, type Booking } from '@/lib/bookings';
import { lagosToday } from '@/lib/transfers';

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

beforeEach(() => {
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
