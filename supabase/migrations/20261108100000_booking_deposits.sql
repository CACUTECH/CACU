-- Bookings, part 2: deposits (Doc 10 services rules, Doc 09 PR-12; customer deposits and advances, 2100).
--  * the owner sets a deposit per service (a fixed amount or a percentage of the price), the free-cancellation window
--    in hours, and what happens to a deposit on a late cancellation or no-show (kept as income by default, decided
--    7 November 2026, or refunded);
--  * a deposit is taken on a confirmed or checked-in booking: cash debits the till, a transfer waits in Transfers
--    awaiting confirmation (BR-010) and is confirmed or marked not received on Daily reconciliation; both credit
--    Customer deposits and advances (PR-12). Cash deposits join the cashier's open shift;
--  * cancelling inside the free window refunds the deposit; a late cancellation or no-show follows the owner's rule,
--    and choosing the other outcome needs sales.approve. A booking holding a deposit is cancelled or marked no-show
--    only through the accounting API, so the booking and the deposit settle in one transaction;
--  * applying a held deposit to the invoice or sale (PR-13) is part 3.
-- Customer deposits and advances is added to a business's chart the first time an owner or admin sets a deposit, as
-- an added account of the new kind customer_deposits (codes 2100 to 2199), like any account added once the books are on.
SET LOCAL search_path = accounting, public, pg_catalog;

-- (Only where the chart schema exists: every hosted project has it; bare test databases add it with the chart.)
DO $kinds$ BEGIN
 IF to_regclass('onboarding_private.account_kinds') IS NOT NULL THEN
  INSERT INTO onboarding_private.account_kinds(kind, account_type, library_type, flow_section, purpose, band_start, band_end, step)
VALUES ('customer_deposits', 'liability', 'CURRENT_LIABILITY', 'operating', 'customer_deposits', 2100, 2199, 10)
ON CONFLICT (kind) DO NOTHING;
 END IF;
END $kinds$;

CREATE TABLE accounting.booking_policy (
 business_id uuid PRIMARY KEY REFERENCES public.businesses(id),
 free_cancel_hours integer NOT NULL DEFAULT 24 CHECK (free_cancel_hours BETWEEN 0 AND 720),
 late_deposit text NOT NULL DEFAULT 'keep' CHECK (late_deposit IN ('keep', 'refund')),
 updated_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounting.service_deposit_rule (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 service_id uuid NOT NULL,
 kind text NOT NULL CHECK (kind IN ('fixed', 'percent')),
 value numeric(15,2) NOT NULL CHECK (value > 0 AND (kind <> 'percent' OR value <= 100)),
 updated_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id, service_id)
);

-- id is the request key that took the deposit.
CREATE TABLE accounting.booking_deposit (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 id uuid NOT NULL,
 appointment_id uuid NOT NULL,
 amount numeric(15,2) NOT NULL CHECK (amount > 0),
 method text NOT NULL CHECK (method IN ('cash', 'transfer')),
 bank_account_id uuid,
 status text NOT NULL CHECK (status IN ('awaiting_transfer', 'held', 'not_received', 'refunded', 'forfeited', 'applied')),
 received_by uuid NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), received_on date NOT NULL,
 settled_by uuid, settled_at timestamptz, settled_on date,
 settle_note text CHECK (length(settle_note) <= 500),
 posting jsonb NOT NULL,
 settlement jsonb,
 PRIMARY KEY (business_id, id),
 -- A transfer names its bank once confirmed; cash never does.
 CHECK (method = 'transfer' OR bank_account_id IS NULL),
 CHECK (status IN ('awaiting_transfer', 'not_received') OR method = 'cash' OR bank_account_id IS NOT NULL),
 CHECK ((status IN ('awaiting_transfer', 'held')) = (settled_by IS NULL AND settled_at IS NULL AND settled_on IS NULL))
);
-- One open deposit per booking.
CREATE UNIQUE INDEX booking_deposit_open ON accounting.booking_deposit (business_id, appointment_id) WHERE status IN ('awaiting_transfer', 'held');
CREATE INDEX booking_deposit_booking ON accounting.booking_deposit (business_id, appointment_id);

-- A deposit moves forward once: awaiting_transfer -> held or not_received; held -> refunded, forfeited or applied.
CREATE FUNCTION accounting.booking_deposit_moves() RETURNS trigger LANGUAGE plpgsql
 SET search_path = pg_catalog AS $$
BEGIN
 IF (OLD.status, NEW.status) NOT IN (('awaiting_transfer', 'held'), ('awaiting_transfer', 'not_received'),
                                      ('held', 'refunded'), ('held', 'forfeited'), ('held', 'applied')) THEN
  RAISE EXCEPTION 'DEPOSIT_ALREADY_SETTLED' USING ERRCODE = '23514';
 END IF;
 IF (NEW.business_id, NEW.id, NEW.appointment_id, NEW.amount, NEW.method, NEW.received_by, NEW.received_at, NEW.received_on, NEW.posting)
    IS DISTINCT FROM (OLD.business_id, OLD.id, OLD.appointment_id, OLD.amount, OLD.method, OLD.received_by, OLD.received_at, OLD.received_on, OLD.posting) THEN
  RAISE EXCEPTION 'DEPOSIT_RECORD_IMMUTABLE' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER booking_deposit_moves BEFORE UPDATE ON accounting.booking_deposit
 FOR EACH ROW EXECUTE FUNCTION accounting.booking_deposit_moves();

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['booking_policy', 'service_deposit_rule', 'booking_deposit'] LOOP
  EXECUTE format('ALTER TABLE accounting.%I ENABLE ROW LEVEL SECURITY', tab);
  EXECUTE format('ALTER TABLE accounting.%I FORCE ROW LEVEL SECURITY', tab);
  EXECUTE format('CREATE POLICY tenant_access ON accounting.%I TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id))', tab);
 END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON accounting.booking_policy TO cacu_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON accounting.service_deposit_rule TO cacu_runtime;
GRANT SELECT, INSERT ON accounting.booking_deposit TO cacu_runtime;
GRANT UPDATE (status, bank_account_id, settled_by, settled_at, settled_on, settle_note, settlement) ON accounting.booking_deposit TO cacu_runtime;

-- Deposits paid by transfer wait with the other transfers.
ALTER TABLE accounting.pending_transfer DROP CONSTRAINT IF EXISTS pending_transfer_source_type_check;
ALTER TABLE accounting.pending_transfer ADD CONSTRAINT pending_transfer_source_type_check CHECK (source_type IN ('pos', 'receipt', 'deposit'));

-- Cash deposits and their refunds move a shift's expected cash.
ALTER TABLE accounting.till_shift_entry DROP CONSTRAINT IF EXISTS till_shift_entry_kind_check;
ALTER TABLE accounting.till_shift_entry DROP CONSTRAINT IF EXISTS till_shift_entry_check;
ALTER TABLE accounting.till_shift_entry ADD CONSTRAINT till_shift_entry_kind_check
 CHECK (kind IN ('sale', 'refund', 'pay_in', 'pay_out', 'sale_reversed', 'deposit', 'deposit_refund'));
ALTER TABLE accounting.till_shift_entry ADD CONSTRAINT till_shift_entry_check
 CHECK (CASE kind WHEN 'sale' THEN cash >= 0 WHEN 'pay_in' THEN cash > 0 WHEN 'deposit' THEN cash > 0 ELSE cash < 0 END);

-- The accounting API reads bookings and moves a booking holding a deposit to cancelled or no-show.
GRANT SELECT, UPDATE ON public.appointments TO cacu_runtime;
CREATE POLICY appointments_runtime_read ON public.appointments FOR SELECT TO cacu_runtime USING (accounting.authorized(business_id));
CREATE POLICY appointments_runtime_change ON public.appointments FOR UPDATE TO cacu_runtime
 USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));

-- Through the Data API, a booking holding a deposit (or waiting for a deposit transfer) cannot be cancelled or marked
-- no-show: the deposit must be settled with it.
CREATE FUNCTION public.appointments_deposit_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 IF NEW.status IN ('cancelled', 'no_show') AND NEW.status IS DISTINCT FROM OLD.status
    AND NOT (session_user = 'cacu_runtime' OR current_setting('role', true) = 'cacu_runtime')
    AND EXISTS (SELECT FROM accounting.booking_deposit d WHERE d.business_id = NEW.business_id AND d.appointment_id = NEW.id
                AND d.status IN ('awaiting_transfer', 'held')) THEN
  RAISE EXCEPTION 'DEPOSIT_HELD' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.appointments_deposit_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER appointments_deposit_guard BEFORE UPDATE ON public.appointments
 FOR EACH ROW EXECUTE FUNCTION public.appointments_deposit_guard();
