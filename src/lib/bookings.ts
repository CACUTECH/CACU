// Bookings (Doc 10 services, bookings and jobs rules). Times are Africa/Lagos, which is UTC+1 all year (no daylight
// saving), the same zone the database checks working hours in.
export type BookingStatus = 'confirmed' | 'checked_in' | 'completed' | 'cancelled' | 'no_show';
export type Staff = { id: string; name: string; is_active: boolean };
export type Service = { id: string; name: string; duration: number | null; unit_price: number };
export type StaffService = { staff_id: string; service_id: string };
export type Hours = { staff_id: string; weekday: number; starts: string; ends: string };
export type TimeOff = { id: string; staff_id: string; starts_at: string; ends_at: string; reason: string };
export type Booking = {
  id: string; staff_id: string; service_id: string; scheduled_at: string; ends_at: string; duration_minutes: number; title: string;
  status: BookingStatus; customer_id: string | null; customer_name: string | null; customer_phone: string | null; notes: string | null;
  cancel_reason: string | null; bill_kind?: 'sale' | 'invoice' | null;
};

// Deposits (Doc 10, PR-12): set per service by the owner, held in Customer deposits and advances.
export type DepositRule = { service_id: string; kind: 'fixed' | 'percent'; value: string };
export type BookingSettings = { free_cancel_hours: number; late_deposit: 'keep' | 'refund'; deposits_ready: boolean; rules: DepositRule[] };
export type Deposit = {
  id: string; appointment_id: string; amount: string; method: 'cash' | 'transfer';
  status: 'awaiting_transfer' | 'held' | 'not_received' | 'refunded' | 'forfeited' | 'applied';
  received_on: string; settled_on: string | null; bank_account_id: string | null;
};
export type BookingBill = {
  id: string; status: BookingStatus; customer_id: string | null; customer_name: string | null; service_id: string; service: string | null;
  price: string | null; bill_kind: 'sale' | 'invoice' | null; bill_id: string | null;
  deposit: { amount: string; method: 'cash' | 'transfer'; status: 'awaiting_transfer' | 'held' } | null;
};
export const DEPOSIT_LABELS: Record<Deposit['status'], string> = {
  awaiting_transfer: 'transfer awaiting confirmation', held: 'held', not_received: 'transfer not received',
  refunded: 'refunded', forfeited: 'kept', applied: 'applied to the bill',
};

/** The deposit a service asks for, in kobo: a fixed amount (never more than the price) or a percentage, half up. */
export function expectedDepositKobo(rule: Pick<DepositRule, 'kind' | 'value'> | undefined, price: number) {
  if (!rule) return 0;
  const priceKobo = Math.round(price * 100);
  if (rule.kind === 'fixed') return Math.min(Math.round(Number(rule.value) * 100), priceKobo);
  return Math.floor((priceKobo * Math.round(Number(rule.value) * 100) + 5000) / 10000);
}

/** Whether cancelling now is inside the free-cancellation window, so a held deposit is refunded. */
export function freeToCancel(startsAt: string, freeHours: number, now = new Date()) {
  return now.getTime() <= new Date(startsAt).getTime() - freeHours * 3600000;
}

export const STATUS_LABELS: Record<BookingStatus, string> = {
  confirmed: 'Confirmed', checked_in: 'Checked in', completed: 'Completed', cancelled: 'Cancelled', no_show: 'No-show',
};
/** Bookings that hold their staff member's time. */
export const BUSY: BookingStatus[] = ['confirmed', 'checked_in', 'completed'];
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const OFFSET_MS = 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, '0');

/** The Lagos calendar day of an instant, as YYYY-MM-DD. */
export function lagosDay(instant: string | Date) {
  return new Date(new Date(instant).getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** The Lagos clock time of an instant, as HH:MM. */
export function lagosTime(instant: string | Date) {
  return new Date(new Date(instant).getTime() + OFFSET_MS).toISOString().slice(11, 16);
}

/** A Lagos day and clock time as an instant the database accepts. */
export function lagosInstant(day: string, time: string) {
  return `${day}T${time.slice(0, 5)}:00+01:00`;
}

/** ISO weekday of a calendar day: 1 Monday to 7 Sunday. */
export function isoWeekday(day: string) {
  const d = new Date(`${day}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function addDays(day: string, days: number) {
  return new Date(new Date(`${day}T12:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
}

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const clock = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

/** The service's duration in minutes: an hour when it has none, as the database does. */
export function serviceMinutes(service: Pick<Service, 'duration'> | undefined) {
  const value = Number(service?.duration ?? 0);
  return Math.min(Math.max(value > 0 ? value : 60, 5), 720);
}

/**
 * Start times on a day when a staff member can take a booking of this length: inside their working hours for that
 * weekday (any time from 07:00 to 21:00 when they have no hours set), clear of their time off and other bookings,
 * and not already past. `except` leaves out the booking being rescheduled.
 */
export function freeSlots({ day, duration, staffId, hours, timeOff, bookings, now = new Date(), step = 15, except }: {
  day: string; duration: number; staffId: string; hours: Hours[]; timeOff: TimeOff[]; bookings: Booking[];
  now?: Date; step?: number; except?: string;
}): string[] {
  const own = hours.filter(h => h.staff_id === staffId);
  const ranges = own.length === 0 ? [{ starts: '07:00', ends: '21:00' }] : own.filter(h => h.weekday === isoWeekday(day));
  const busy = [
    ...bookings.filter(b => b.staff_id === staffId && b.id !== except && BUSY.includes(b.status)).map(b => [b.scheduled_at, b.ends_at]),
    ...timeOff.filter(t => t.staff_id === staffId).map(t => [t.starts_at, t.ends_at]),
  ].map(([a, b]) => [new Date(a).getTime(), new Date(b).getTime()]);
  const slots = new Set<string>();
  for (const range of ranges) {
    for (let m = minutes(range.starts); m + duration <= minutes(range.ends); m += step) {
      const start = new Date(lagosInstant(day, clock(m))).getTime();
      const end = start + duration * 60000;
      if (start < now.getTime()) continue;
      if (busy.some(([a, b]) => start < b && a < end)) continue;
      slots.add(clock(m));
    }
  }
  return [...slots].sort();
}

const MESSAGES: Record<string, string> = {
  BOOKING_OVERLAP: 'That time is already booked for this staff member. Choose another time.',
  OUTSIDE_WORKING_HOURS: 'That time is outside the staff member’s working hours.',
  STAFF_TIME_OFF: 'The staff member is off at that time.',
  STAFF_CANNOT_DELIVER: 'This staff member does not do that service, or no longer works here.',
  SERVICE_UNAVAILABLE: 'That service is not available. Check it is active in your catalogue.',
  CUSTOMER_REQUIRED: 'Choose a customer or type their name.',
  CUSTOMER_UNAVAILABLE: 'That customer is not in this business.',
  BOOKING_IN_PAST: 'That time has already passed.',
  BOOKING_NOT_RESCHEDULABLE: 'Only a confirmed booking can be moved.',
  BOOKING_STATE_INVALID: 'This booking has already moved on. Refresh to see its latest state.',
  CANCEL_REASON_REQUIRED: 'Say why the booking is cancelled.',
  NO_SHOW_TOO_EARLY: 'A booking can be marked no-show only after its start time.',
  DEPOSIT_HELD: 'This booking holds a deposit. Cancel it from the booking so the deposit is settled with it.',
  SUBSCRIPTION_READ_ONLY: 'Your workspace is read-only until the subscription is paid.',
};

/** A database refusal in plain words. */
export function bookingError(error: { message?: string; code?: string } | null | undefined, fallback = 'The booking was not saved. Refresh and try again.') {
  const message = error?.message ?? '';
  const known = Object.keys(MESSAGES).find(code => message.includes(code));
  if (known) return MESSAGES[known];
  if (error?.code === '42501' || /row-level security|permission denied/i.test(message)) return 'You do not have permission to do this. Ask the business owner.';
  if (error?.code === '23505') return 'Someone with that name is already on your staff list.';
  return fallback;
}
