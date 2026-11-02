-- Security audit run 1, lead 3 (Doc 16). Viewers could add suppliers directly through the Data API, because
-- suppliers_insert only required membership while update and delete already required a writing role.
SET LOCAL search_path = public, pg_catalog;

DROP POLICY IF EXISTS suppliers_insert ON public.suppliers;
CREATE POLICY suppliers_insert ON public.suppliers FOR INSERT
 WITH CHECK (has_business_role(business_id, ARRAY['owner','admin','editor']::membership_role[]));
