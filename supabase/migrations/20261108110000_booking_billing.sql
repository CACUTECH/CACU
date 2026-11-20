-- Bookings, part 3: billing a completed booking (Doc 10 services rules, Doc 09 PR-13 and PR-11).
--  * at the till: the service is sold like any till sale, and a held deposit is applied to it, so the customer pays
--    only the rest. The sale credits revenue for the full price; the deposit leaves Customer deposits and advances
--    against the till (cash) or Transfers awaiting confirmation (transfer);
--  * by invoice: an invoice to the booking's customer is issued for the service, and a held deposit is applied to it
--    like a payment (debit Customer deposits and advances, credit the customer's receivable, allocated to the invoice);
--  * a booking is billed once, records how (bill_kind) and what (bill_id), and only the accounting API sets either.
SET LOCAL search_path = public, pg_catalog;

ALTER TABLE public.appointments
 ADD COLUMN IF NOT EXISTS bill_kind text CHECK (bill_kind IN ('sale', 'invoice')),
 ADD COLUMN IF NOT EXISTS bill_id uuid,
 ADD COLUMN IF NOT EXISTS billed_at timestamptz;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_billed_together
 CHECK ((bill_kind IS NULL) = (bill_id IS NULL) AND (bill_kind IS NULL) = (billed_at IS NULL));
ALTER TABLE public.appointments ADD CONSTRAINT appointments_billed_when_completed CHECK (bill_kind IS NULL OR status = 'completed');

-- What a till sale took from a booking's deposit, for the receipt.
ALTER TABLE public.transactions
 ADD COLUMN IF NOT EXISTS booking_id uuid,
 ADD COLUMN IF NOT EXISTS deposit_applied numeric(15,2) NOT NULL DEFAULT 0 CHECK (deposit_applied >= 0);

-- The deposit applied at the till comes off the cash a shift should hold, since the customer paid it earlier.
ALTER TABLE accounting.till_shift_entry DROP CONSTRAINT IF EXISTS till_shift_entry_kind_check;
ALTER TABLE accounting.till_shift_entry ADD CONSTRAINT till_shift_entry_kind_check
 CHECK (kind IN ('sale', 'refund', 'pay_in', 'pay_out', 'sale_reversed', 'deposit', 'deposit_refund', 'deposit_applied'));

-- Through the Data API a booking holding a deposit cannot be cancelled or marked no-show, and nobody sets or clears
-- how a booking was billed: both settle money, which only the accounting API does.
CREATE OR REPLACE FUNCTION public.appointments_deposit_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE runtime boolean := session_user = 'cacu_runtime' OR current_setting('role', true) = 'cacu_runtime';
BEGIN
 IF (NEW.bill_kind, NEW.bill_id, NEW.billed_at) IS DISTINCT FROM (OLD.bill_kind, OLD.bill_id, OLD.billed_at) THEN
  IF NOT runtime OR OLD.bill_kind IS NOT NULL THEN RAISE EXCEPTION 'BOOKING_BILLED_ONCE' USING ERRCODE = '23514'; END IF;
 END IF;
 IF NEW.status IN ('cancelled', 'no_show') AND NEW.status IS DISTINCT FROM OLD.status AND NOT runtime
    AND EXISTS (SELECT FROM accounting.booking_deposit d WHERE d.business_id = NEW.business_id AND d.appointment_id = NEW.id
                AND d.status IN ('awaiting_transfer', 'held')) THEN
  RAISE EXCEPTION 'DEPOSIT_HELD' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.appointments_deposit_guard() FROM PUBLIC, anon, authenticated;
