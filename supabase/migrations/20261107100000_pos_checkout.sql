-- POS, part 2 (Doc 10 checkout rules, BR-022, decided 7 November 2026):
--  * cash received and change are recorded on the sale; line discounts are recorded on the line;
--  * a line discount needs sales.edit and is capped per template by the owner (5% unless the owner sets otherwise;
--    owners are not capped). The Cashier template gains sales.edit for this;
--  * selling more than recorded stock is off unless the owner switches it on; when on, each shortfall is listed for
--    review (RSK-027).
SET LOCAL search_path = public, pg_catalog;

ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS cash_received numeric(15,2) CHECK (cash_received >= 0),
 ADD COLUMN IF NOT EXISTS change_given numeric(15,2) CHECK (change_given >= 0),
 ADD COLUMN IF NOT EXISTS transfer_amount numeric(15,2) CHECK (transfer_amount >= 0),
 ADD COLUMN IF NOT EXISTS discount_total numeric(15,2) NOT NULL DEFAULT 0 CHECK (discount_total >= 0);
ALTER TABLE public.transaction_items ADD COLUMN IF NOT EXISTS discount numeric(15,2) NOT NULL DEFAULT 0 CHECK (discount >= 0);
DO $$
BEGIN
 IF EXISTS (SELECT FROM pg_constraint WHERE conrelid = 'public.transactions'::regclass AND conname = 'transactions_payment_method_check') THEN
  ALTER TABLE public.transactions DROP CONSTRAINT transactions_payment_method_check;
  ALTER TABLE public.transactions ADD CONSTRAINT transactions_payment_method_check CHECK (payment_method IN ('cash', 'card', 'transfer', 'split'));
 END IF;
END $$;

-- One row per business, set by the Owner. No row: overselling off.
CREATE TABLE accounting.sales_policy (
 business_id uuid PRIMARY KEY REFERENCES public.businesses(id),
 allow_oversell boolean NOT NULL DEFAULT false,
 updated_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);

-- A sale that took a product below its recorded stock (only when overselling is on).
CREATE TABLE accounting.stock_shortfall (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 sale_id uuid NOT NULL,
 item_id uuid NOT NULL,
 quantity integer NOT NULL CHECK (quantity > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by uuid, reviewed_at timestamptz,
 PRIMARY KEY (business_id, sale_id, item_id)
);
CREATE INDEX stock_shortfall_open ON accounting.stock_shortfall (business_id, created_at) WHERE reviewed_at IS NULL;

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['sales_policy', 'stock_shortfall'] LOOP
  EXECUTE format('ALTER TABLE accounting.%I ENABLE ROW LEVEL SECURITY', tab);
  EXECUTE format('ALTER TABLE accounting.%I FORCE ROW LEVEL SECURITY', tab);
  EXECUTE format('CREATE POLICY tenant_access ON accounting.%I TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id))', tab);
 END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON accounting.sales_policy TO cacu_runtime;
GRANT SELECT, INSERT ON accounting.stock_shortfall TO cacu_runtime;
GRANT UPDATE (reviewed_by, reviewed_at) ON accounting.stock_shortfall TO cacu_runtime;

-- Discount caps: per business and template, in percent of the line. Templates are shared, so the cap is per business.
CREATE TABLE authz.discount_caps (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 template_id uuid NOT NULL REFERENCES authz.role_templates(id),
 max_percent numeric(5,2) NOT NULL CHECK (max_percent BETWEEN 0 AND 100),
 updated_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id, template_id)
);
ALTER TABLE authz.discount_caps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON authz.discount_caps FROM PUBLIC, anon, authenticated;

INSERT INTO authz.role_template_permissions(template_id, permission_code)
SELECT id, 'sales.edit' FROM authz.role_templates WHERE code = 'cashier' AND business_id IS NULL
ON CONFLICT DO NOTHING;

-- The largest line discount, in percent, the caller may give: 100 for the Owner, 0 without sales.edit, otherwise
-- the owner's cap for their template (5 unless set).
CREATE OR REPLACE FUNCTION authz.discount_cap(p_business_id uuid) RETURNS numeric
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE m public.memberships%ROWTYPE;
BEGIN
 SELECT * INTO m FROM public.memberships WHERE business_id = p_business_id AND user_id = auth.uid() AND is_active;
 IF NOT FOUND THEN RETURN 0; END IF;
 IF m.role::text = 'owner' THEN RETURN 100; END IF;
 IF NOT authz.has_permission(p_business_id, 'sales.edit') THEN RETURN 0; END IF;
 RETURN coalesce((SELECT max_percent FROM authz.discount_caps WHERE business_id = p_business_id AND template_id = m.role_template_id), 5);
END $$;
REVOKE ALL ON FUNCTION authz.discount_cap(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION authz.discount_cap(uuid) TO authenticated, cacu_runtime;

-- The Owner sets a template's cap.
CREATE OR REPLACE FUNCTION public.save_discount_cap(p_business_id uuid, p_template_id uuid, p_max_percent numeric) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid;
BEGIN
 actor := management_private.authorize(p_business_id, ARRAY['owner'], true);
 IF p_max_percent IS NULL OR p_max_percent < 0 OR p_max_percent > 100 OR p_max_percent <> round(p_max_percent, 2) THEN
  RAISE EXCEPTION 'INVALID_DISCOUNT_CAP' USING ERRCODE = '22023';
 END IF;
 IF NOT EXISTS (SELECT FROM authz.role_templates WHERE id = p_template_id AND (business_id IS NULL OR business_id = p_business_id) AND code <> 'owner') THEN
  RAISE EXCEPTION 'TEMPLATE_INVALID' USING ERRCODE = '22023';
 END IF;
 INSERT INTO authz.discount_caps(business_id, template_id, max_percent, updated_by) VALUES (p_business_id, p_template_id, p_max_percent, actor)
 ON CONFLICT (business_id, template_id) DO UPDATE SET max_percent = EXCLUDED.max_percent, updated_by = EXCLUDED.updated_by, updated_at = now();
 INSERT INTO management_private.audit(business_id, actor_id, event, record_id, details)
 VALUES (p_business_id, actor, 'template.discount_cap', p_template_id, jsonb_build_object('max_percent', p_max_percent));
 RETURN jsonb_build_object('template_id', p_template_id, 'max_percent', p_max_percent);
END $$;
REVOKE ALL ON FUNCTION public.save_discount_cap(uuid, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_discount_cap(uuid, uuid, numeric) TO authenticated;

-- What the team screen shows per template: the discount cap in this business (null when the template cannot discount).
CREATE OR REPLACE FUNCTION public.discount_caps(p_business_id uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 PERFORM authz.require(p_business_id, 'settings.view');
 RETURN coalesce((SELECT jsonb_object_agg(t.id, CASE WHEN t.code = 'owner' THEN 100
     WHEN EXISTS (SELECT FROM authz.role_template_permissions p WHERE p.template_id = t.id AND p.permission_code = 'sales.edit')
     THEN coalesce(c.max_percent, 5) END)
   FROM authz.role_templates t LEFT JOIN authz.discount_caps c ON c.template_id = t.id AND c.business_id = p_business_id
   WHERE t.business_id IS NULL OR t.business_id = p_business_id), '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.discount_caps(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discount_caps(uuid) TO authenticated;
