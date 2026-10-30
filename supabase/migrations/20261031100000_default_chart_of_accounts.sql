-- Default chart of accounts (Doc 09 section 4, ACC-012, FR-131; Doc 16 country module "chart template").
-- NG-2026.1 holds the R1 accounts from Doc 09, filtered by business mode, with each account's purpose and
-- cash-flow section for provisioning. It stays 'pending_review' until the platform accountant (DEP-02) signs it
-- off; adoption is allowed before that so owners can see their chart, but provisioning refuses an unreviewed
-- template outside staging (backend/tools/default_chart_mapping.py).
-- Departures from Doc 09: the opening balance equity account (3900) carries the purpose 'equity', which the
-- catalogue opening-stock posting already uses; service-only businesses post sales to Service income (4100).
-- R2 to R4 accounts (gateway clearing, deposits, VAT, WHT, payroll liabilities, fixed assets) arrive in later
-- template versions; a version is never edited after use, only superseded.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE onboarding_private.chart_templates (
  version text PRIMARY KEY, country text NOT NULL,
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'reviewed')),
  reviewed_by text, reviewed_at timestamptz,
  CHECK (status = 'pending_review' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE TABLE onboarding_private.chart_template_accounts (
  version text NOT NULL REFERENCES onboarding_private.chart_templates, mode text NOT NULL CHECK (mode IN ('PRODUCT', 'SERVICE', 'HYBRID')),
  code text NOT NULL, name text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  library_type text NOT NULL CHECK (library_type IN ('NON_CURRENT_ASSET', 'CONTRA_ASSET', 'INVENTORY', 'BANK', 'CURRENT_ASSET', 'RECEIVABLE',
    'NON_CURRENT_LIABILITY', 'CONTROL', 'CURRENT_LIABILITY', 'PAYABLE', 'RECONCILIATION', 'EQUITY', 'OPERATING_REVENUE', 'OPERATING_EXPENSE',
    'NON_OPERATING_REVENUE', 'DIRECT_EXPENSE', 'OVERHEAD_EXPENSE', 'OTHER_EXPENSE')),
  purpose text, flow_section text NOT NULL CHECK (flow_section IN ('cash', 'operating', 'investing', 'financing', 'restricted')),
  PRIMARY KEY (version, mode, code),
  CHECK (purpose NOT IN ('cash', 'bank') OR (library_type = 'BANK' AND flow_section = 'cash'))
);
CREATE UNIQUE INDEX chart_template_single_purpose ON onboarding_private.chart_template_accounts (version, mode, purpose)
  WHERE purpose IS NOT NULL AND purpose <> 'bank';
CREATE TABLE onboarding_private.chart_adoptions (
  business_id uuid PRIMARY KEY REFERENCES public.businesses ON DELETE RESTRICT,
  version text NOT NULL REFERENCES onboarding_private.chart_templates, mode text NOT NULL,
  adopted_by uuid NOT NULL, request_key uuid NOT NULL, adopted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE onboarding_private.chart_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_private.chart_template_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_private.chart_adoptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_private.chart_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE onboarding_private.chart_template_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE onboarding_private.chart_adoptions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON onboarding_private.chart_templates, onboarding_private.chart_template_accounts, onboarding_private.chart_adoptions
  FROM PUBLIC, anon, authenticated;

INSERT INTO onboarding_private.chart_templates(version, country) VALUES ('NG-2026.1', 'NG');
INSERT INTO onboarding_private.chart_template_accounts(version, mode, code, name, account_type, library_type, purpose, flow_section)
SELECT 'NG-2026.1', mode, code, name, account_type, library_type, purpose, flow_section
FROM (VALUES
  ('1000', 'Cash on hand', 'asset', 'BANK', 'cash', 'cash', '{PRODUCT,SERVICE,HYBRID}'),
  ('1010', 'Bank account', 'asset', 'BANK', 'bank', 'cash', '{PRODUCT,SERVICE,HYBRID}'),
  ('1020', 'Transfers awaiting confirmation', 'asset', 'CURRENT_ASSET', 'transfer_clearing', 'operating', '{PRODUCT,SERVICE,HYBRID}'),
  ('1100', 'Trade receivables', 'asset', 'RECEIVABLE', 'receivables', 'operating', '{PRODUCT,SERVICE,HYBRID}'),
  ('1200', 'Inventory', 'asset', 'INVENTORY', 'inventory', 'operating', '{PRODUCT,HYBRID}'),
  ('1300', 'Prepayments', 'asset', 'CURRENT_ASSET', 'prepayments', 'operating', '{PRODUCT,SERVICE,HYBRID}'),
  ('2000', 'Trade payables', 'liability', 'PAYABLE', 'payables', 'operating', '{PRODUCT,SERVICE,HYBRID}'),
  ('2400', 'Accrued expenses', 'liability', 'CURRENT_LIABILITY', 'accruals', 'operating', '{PRODUCT,SERVICE,HYBRID}'),
  ('2500', 'Loans and borrowings', 'liability', 'NON_CURRENT_LIABILITY', NULL, 'financing', '{PRODUCT,SERVICE,HYBRID}'),
  ('3000', 'Owner''s capital', 'equity', 'EQUITY', 'capital', 'financing', '{PRODUCT,SERVICE,HYBRID}'),
  ('3100', 'Owner''s drawings', 'equity', 'EQUITY', 'drawings', 'financing', '{PRODUCT,SERVICE,HYBRID}'),
  ('3200', 'Retained earnings', 'equity', 'EQUITY', 'retained_earnings', 'financing', '{PRODUCT,SERVICE,HYBRID}'),
  ('3900', 'Opening balance equity', 'equity', 'EQUITY', 'equity', 'financing', '{PRODUCT,SERVICE,HYBRID}'),
  ('4000', 'Sales of goods', 'revenue', 'OPERATING_REVENUE', 'revenue', 'operating', '{PRODUCT,HYBRID}'),
  ('4100', 'Service income', 'revenue', 'OPERATING_REVENUE', 'service_revenue', 'operating', '{PRODUCT,HYBRID}'),
  ('4100', 'Service income', 'revenue', 'OPERATING_REVENUE', 'revenue', 'operating', '{SERVICE}'),
  ('4900', 'Other income', 'revenue', 'NON_OPERATING_REVENUE', NULL, 'operating', '{PRODUCT,SERVICE,HYBRID}'),
  ('5000', 'Cost of goods sold', 'expense', 'DIRECT_EXPENSE', 'cogs', 'operating', '{PRODUCT,HYBRID}'),
  ('5100', 'Inventory adjustments and write-offs', 'expense', 'DIRECT_EXPENSE', 'stock_adjustment', 'operating', '{PRODUCT,HYBRID}'),
  ('6000', 'Salaries and wages', 'expense', 'OPERATING_EXPENSE', NULL, 'operating', '{PRODUCT,SERVICE,HYBRID}'),
  ('6100', 'Rent', 'expense', 'OPERATING_EXPENSE', NULL, 'operating', '{PRODUCT,SERVICE,HYBRID}'),
  ('6200', 'Utilities and power (including diesel)', 'expense', 'OPERATING_EXPENSE', NULL, 'operating', '{PRODUCT,SERVICE,HYBRID}'),
  ('6300', 'Transport and logistics', 'expense', 'OPERATING_EXPENSE', NULL, 'operating', '{PRODUCT,SERVICE,HYBRID}'),
  ('6400', 'Bank and payment charges', 'expense', 'OPERATING_EXPENSE', 'gateway_fees', 'operating', '{PRODUCT,SERVICE,HYBRID}'),
  ('6500', 'Marketing', 'expense', 'OPERATING_EXPENSE', NULL, 'operating', '{PRODUCT,SERVICE,HYBRID}'),
  ('6600', 'Repairs and maintenance', 'expense', 'OPERATING_EXPENSE', NULL, 'operating', '{PRODUCT,SERVICE,HYBRID}'),
  ('6800', 'CACU and other subscriptions', 'expense', 'OPERATING_EXPENSE', NULL, 'operating', '{PRODUCT,SERVICE,HYBRID}'),
  ('6900', 'Cash over and short', 'expense', 'OPERATING_EXPENSE', 'cash_variance', 'operating', '{PRODUCT,SERVICE,HYBRID}'),
  ('7000', 'Interest expense', 'expense', 'OTHER_EXPENSE', NULL, 'operating', '{PRODUCT,SERVICE,HYBRID}')
) AS t(code, name, account_type, library_type, purpose, flow_section, modes), unnest(modes::text[]) AS mode;

-- Owner or Admin adopts the current template for the business's mode (DEC-004). Safe to retry.
CREATE FUNCTION public.adopt_default_chart(p_business_id uuid, p_request_key uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE actor uuid; adoption onboarding_private.chart_adoptions%ROWTYPE; v_mode text; v_version text; created integer;
BEGIN
 IF p_business_id IS NULL OR p_request_key IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = '22023'; END IF;
 actor := management_private.authorize(p_business_id, ARRAY['owner', 'admin'], true);
 SELECT * INTO adoption FROM onboarding_private.chart_adoptions WHERE business_id = p_business_id;
 IF FOUND THEN
  RETURN jsonb_build_object('version', adoption.version, 'mode', adoption.mode, 'replayed', true,
   'accounts', (SELECT count(*) FROM public.accounts WHERE business_id = p_business_id));
 END IF;
 IF accounting.active(p_business_id) OR EXISTS (SELECT FROM accounting.business_map WHERE business_id = p_business_id) THEN
  RAISE EXCEPTION 'BOOKS_ALREADY_SET_UP' USING ERRCODE = '23514';
 END IF;
 IF EXISTS (SELECT FROM public.accounts WHERE business_id = p_business_id) THEN RAISE EXCEPTION 'CHART_EXISTS' USING ERRCODE = '23514'; END IF;
 SELECT business_type INTO v_mode FROM public.businesses WHERE id = p_business_id;
 SELECT version INTO v_version FROM onboarding_private.chart_templates WHERE country = 'NG' ORDER BY version DESC LIMIT 1;
 INSERT INTO public.accounts(business_id, code, name, account_type)
  SELECT p_business_id, code, name, account_type FROM onboarding_private.chart_template_accounts
  WHERE version = v_version AND mode = v_mode ORDER BY code;
 GET DIAGNOSTICS created = ROW_COUNT;
 INSERT INTO onboarding_private.chart_adoptions(business_id, version, mode, adopted_by, request_key)
  VALUES (p_business_id, v_version, v_mode, actor, p_request_key);
 INSERT INTO public.audit_logs(business_id, user_id, action, table_name, record_id, details)
  VALUES (p_business_id, actor, 'CHART_ADOPTED', 'accounts', p_business_id,
   jsonb_build_object('version', v_version, 'mode', v_mode, 'accounts', created, 'request_key', p_request_key));
 RETURN jsonb_build_object('version', v_version, 'mode', v_mode, 'accounts', created, 'replayed', false);
END;$f$;

-- Every active member may read the chart; purposes come from the reviewed mapping once books are provisioned.
CREATE FUNCTION public.chart_of_accounts(p_business_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE adoption onboarding_private.chart_adoptions%ROWTYPE; template onboarding_private.chart_templates%ROWTYPE;
BEGIN
 PERFORM management_private.authorize(p_business_id, ARRAY['owner', 'admin', 'editor', 'viewer']);
 SELECT * INTO adoption FROM onboarding_private.chart_adoptions WHERE business_id = p_business_id;
 SELECT * INTO template FROM onboarding_private.chart_templates WHERE version = adoption.version;
 RETURN jsonb_build_object(
  'template', CASE WHEN adoption.business_id IS NULL THEN NULL ELSE jsonb_build_object('version', template.version,
    'status', template.status, 'reviewed_by', template.reviewed_by, 'reviewed_at', template.reviewed_at, 'adopted_at', adoption.adopted_at) END,
  'books_active', accounting.active(p_business_id),
  'accounts', coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name, 'account_type', a.account_type,
      'purpose', coalesce(m.purpose, t.purpose), 'flow_section', coalesce(m.flow_section, t.flow_section), 'is_active', a.is_active) ORDER BY a.code)
    FROM public.accounts a
    LEFT JOIN accounting.account_map m ON m.business_id = a.business_id AND m.account_id = a.id
    LEFT JOIN onboarding_private.chart_template_accounts t ON t.version = adoption.version AND t.mode = adoption.mode AND t.code = a.code
    WHERE a.business_id = p_business_id), '[]'::jsonb));
END;$f$;

REVOKE ALL ON FUNCTION public.adopt_default_chart(uuid, uuid), public.chart_of_accounts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adopt_default_chart(uuid, uuid), public.chart_of_accounts(uuid) TO authenticated;
COMMIT;
