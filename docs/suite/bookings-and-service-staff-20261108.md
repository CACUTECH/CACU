# Bookings, part 1: service staff and bookings (Doc 10, Doc 07 M-13)

Appointments are now saved to the business. Before this, the screen kept bookings only in the browser and showed "not available yet". Part 1 covers the people customers book, their hours, and the bookings themselves. Nothing in part 1 posts to the books.

Decided 7 November 2026:
- **Who can be booked:** a separate staff list. Anyone can be added by name, on every plan, and they don't need to use CACU.
- **Deposits:** when a customer cancels late or doesn't show, the deposit is kept as income by default. This applies from part 2.

The plan has four parts:
1. Service staff and bookings (this part).
2. Deposits and the cancellation window (PR-12).
3. Completing a booking creates a draft invoice or till sale, with the deposit applied (PR-13).
4. Jobs, with materials and job profit.

## Staff and hours (`/appointments/staff`)

- **Add staff** by name. New staff work Monday to Saturday, 09:00 to 18:00, until the owner changes it.
- **Services:** tick the services each person does. Only the business's own catalogue services can be chosen.
- **Working hours:** one range a day, or off.
  - The database accepts several ranges a day, which leaves breaks between them. The screen edits one range a day and suggests adding breaks as time off.
  - Someone with no hours set can be booked at any time.
- **Time off:** a day with a from and to time, and an optional reason. Covers breaks, days off and appointments.
- **Leaving:** "No longer works here" stops new bookings for that person. Staff are never deleted, so past bookings keep their name. "Bring back" reverses it.
- **Duplicate names:** two active staff can't share a name.

## Bookings (`/appointments`)

- **Day view:** a card per staff member with that day's bookings, showing time, service, customer and status. Change the day with the date picker or the arrows. Times are Lagos time.
- **New booking:** choose the service. Then choose the staff member, from those who do that service. Then choose the day and one of the free times offered, and the customer.
  - The customer can be an existing customer, or a new or walk-in name with an optional phone number.
  - The length is the service's estimated minutes from the catalogue, or an hour when none is set.
- **States:**

  | From | To | Rule |
  |---|---|---|
  | Confirmed | Checked in | |
  | Checked in | Completed | |
  | Confirmed | Cancelled | Needs a reason; the time becomes free |
  | Confirmed | No-show | Only once the start time has passed |
  | Confirmed | Confirmed, new time, staff or service | Reschedule; only a confirmed booking can move |

  - A booking is always Confirmed when made, whatever is sent.
  - Completed, Cancelled and No-show are final for now. Part 3 adds Invoiced and Paid.
- **History:** every booking, state change and move is kept with who made it and when (`appointment_events`).
- **Never deleted:** bookings are cancelled instead.

### The rules the database enforces

These hold however a booking is written: this screen, the Data API, or anything later.

- **No double-booking:** never two bookings at once for the same staff member. Confirmed, checked-in and completed bookings hold their time.
- **Working hours:** inside the staff member's hours for that weekday, within one day.
- **Time off:** never during the staff member's time off.
- **Who and what:** the staff member must be active and do the service; the service must be an active catalogue service; the customer, if chosen, must belong to the business.
- **No past times:** a booking can't start in the past. There is five minutes' grace.
- **Stamped by the database:** who booked it, when, the length, the end time and the title, so none of them can be supplied wrongly.

Doc 10 asks for an exclusion constraint. Instead, the booking trigger takes a lock per staff member and then checks for overlaps, which gives the same guarantee without the `btree_gist` extension; the local test database doesn't have it.

## Who can do what

| Action | Permission | Templates |
|---|---|---|
| See bookings, staff and hours | `services.view` | Everyone with services, including Auditor |
| Make a booking | `services.create` | Owner, Admin, Sales manager, Cashier, Service staff |
| Check in, complete, cancel, no-show, reschedule | `services.edit` | Owner, Admin, Sales manager, Service staff |
| Add staff, set services, hours and time off | `settings.edit` | Owner, Admin |

A Cashier can take a booking at the front desk but not run it. If someone without permission tries, the screen says so.

While a subscription is suspended, new bookings and staff changes are refused, like other trading records.

## Database

Migration `20261108090000_bookings_and_service_staff.sql`:
- New tables, each with row security by the permissions above:
  - `public.service_staff`;
  - `service_staff_services`;
  - `service_staff_hours`;
  - `service_staff_time_off`;
  - `appointment_events`, which can only be read.
- `public.appointments` gains these columns: `staff_id`, `service_id`, `duration_minutes`, `ends_at`, `customer_name`, `customer_phone`, `created_by`, `checked_in_at`, `completed_at`, `cancel_reason`.
  - Status values are now confirmed, checked_in, completed, cancelled or no_show.
  - Any legacy status reads as confirmed. Production has no stored bookings.
- Its old policies are replaced, and the delete grant is removed.
- Rule triggers:
  - `appointments_rules` and `appointments_history`, SECURITY DEFINER so the checks see every booking of the business. They read only the booking's own business and leave access decisions to row security.
  - `service_staff_services_check`.

## Tests

- `test_bookings_postgres.py` (3 cases, as signed-in members through row security):
  - **Booking rules:** the service's length, overlaps, back-to-back bookings, the lunch break, Sunday, time off, a staff member who doesn't do the service, a missing customer, a past time.
  - **States:** a cashier can't run bookings; no-show too early; invalid jumps; reschedules, including into an overlap; check-in and complete; cancel with a reason, which frees the slot. Also the history, no deletes, and a no-show after the start time.
  - **Staff management:** settings-only, with unique names and services only from the catalogue. An auditor can read bookings but not book; a staff member who left can't be booked or deleted.
- Jest `bookings-ui`:
  - Lagos time helpers;
  - free times: hours, breaks, bookings, time off, the past, rescheduling;
  - plain-English errors;
  - making a booking, including an overlap explained;
  - check-in without permission and cancelling with a reason.
- The TEST-407 placeholder tests no longer include Appointments, which is now a real screen. Jobs stays a placeholder until part 4.

## Not yet

- Deposits and the cancellation window (part 2).
- Invoicing a completed booking (part 3).
- Reminders (R3).
- Online booking requests (R3).
- Linking a staff member to an app login, so they see only their own bookings.
- A week view.
