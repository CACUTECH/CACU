-- Doc 08 GAP-07 / SEC-011: signed-in users may call only SECURITY DEFINER functions the app uses, each with a
-- fixed search path and its own membership check (inventory: docs/suite/definer-function-inventory-20261030.md).
-- None of these is called by the web app or the Python core:
--   record_audit           lets any member, including viewers, write audit rows with any action and record id
--   process_sale           forwards to process_sale_safe with a fresh request key, so retries can post twice
--   adjust_inventory_stock already raises; stock changes go through management_write
BEGIN;
REVOKE EXECUTE ON FUNCTION public.record_audit(uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.process_sale(uuid, uuid, jsonb, text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.adjust_inventory_stock(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
COMMIT;
