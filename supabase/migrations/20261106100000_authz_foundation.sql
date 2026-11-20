-- Permission model, part 1 (Doc 08 §5–§6, Doc 07 M-07). Adds the permission catalogue, the ten built-in role templates,
-- two compatibility templates that equal today's editor and viewer rights, per-member overrides, and the one decision
-- function authz.has_permission. Every existing membership is mapped to the template with the same access, so nothing
-- changes for anyone yet: policies and functions keep their role checks until each module is switched (M-08).
SET LOCAL search_path = public, pg_catalog;

CREATE SCHEMA authz;
REVOKE ALL ON SCHEMA authz FROM PUBLIC, anon, authenticated;

-- One action on one module, written module.action. Seeded here; tenants cannot write it.
CREATE TABLE authz.permissions (
 code text PRIMARY KEY CHECK (code ~ '^[a-z]+\.(view|create|edit|approve|post|export|delete)$'),
 module text NOT NULL,
 action text NOT NULL CHECK (action IN ('view', 'create', 'edit', 'approve', 'post', 'export', 'delete'))
);

-- Built-in templates have no business; custom profiles (Oga and Chairman, PR 4) belong to one business.
CREATE TABLE authz.role_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid REFERENCES public.businesses(id),
 code text NOT NULL CHECK (code ~ '^[a-z_]+$'),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
 is_builtin boolean NOT NULL,
 legacy_role text CHECK (legacy_role IN ('owner', 'admin', 'editor', 'viewer')),
 CHECK (is_builtin = (business_id IS NULL))
);
CREATE UNIQUE INDEX role_templates_builtin_code ON authz.role_templates(code) WHERE business_id IS NULL;
CREATE UNIQUE INDEX role_templates_business_code ON authz.role_templates(business_id, code) WHERE business_id IS NOT NULL;

CREATE TABLE authz.role_template_permissions (
 template_id uuid NOT NULL REFERENCES authz.role_templates(id),
 permission_code text NOT NULL REFERENCES authz.permissions(code),
 PRIMARY KEY (template_id, permission_code)
);

-- Per-member additions or removals on top of the template.
CREATE TABLE authz.membership_overrides (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 user_id uuid NOT NULL,
 permission_code text NOT NULL REFERENCES authz.permissions(code),
 effect text NOT NULL CHECK (effect IN ('grant', 'revoke')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id, user_id, permission_code)
);

ALTER TABLE authz.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE authz.role_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE authz.role_template_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE authz.membership_overrides ENABLE ROW LEVEL SECURITY;

INSERT INTO authz.permissions(code, module, action)
SELECT m || '.' || a, m, a
  FROM unnest(ARRAY['sales', 'invoices', 'customers', 'inventory', 'services', 'expenses', 'ledger', 'banking', 'hr', 'settings', 'billing']) m
 CROSS JOIN unnest(ARRAY['view', 'create', 'edit', 'approve', 'post', 'export', 'delete']) a;

-- Doc 08 §5 template table. Letters: V view, C create, E edit, A approve, P post, X export, D delete. The table's
-- "loc" (own outlet) and "own" (own records) qualifiers are applied by location scope and by each module as it switches.
INSERT INTO authz.role_templates(code, name, is_builtin, legacy_role) VALUES
 ('owner', 'Owner', true, 'owner'), ('admin', 'Admin', true, 'admin'), ('accountant', 'Accountant', true, NULL),
 ('bookkeeper', 'Bookkeeper', true, NULL), ('sales_manager', 'Sales manager', true, NULL), ('cashier', 'Cashier', true, NULL),
 ('inventory_manager', 'Inventory manager', true, NULL), ('hr_manager', 'HR manager', true, NULL),
 ('service_staff', 'Service staff', true, NULL), ('auditor', 'Auditor', true, NULL),
 -- Exactly what the editor and viewer roles can do today, so existing members keep their access on migration.
 ('editor_legacy', 'Editor (legacy)', true, 'editor'), ('viewer_legacy', 'Viewer (legacy)', true, 'viewer');

INSERT INTO authz.role_template_permissions(template_id, permission_code)
SELECT t.id, g.module || '.' || CASE l WHEN 'V' THEN 'view' WHEN 'C' THEN 'create' WHEN 'E' THEN 'edit' WHEN 'A' THEN 'approve'
                                       WHEN 'P' THEN 'post' WHEN 'X' THEN 'export' WHEN 'D' THEN 'delete' END
  FROM (VALUES
   ('owner', 'sales', 'VCEAPXD'), ('owner', 'invoices', 'VCEAPXD'), ('owner', 'customers', 'VCEAPXD'), ('owner', 'inventory', 'VCEAPXD'),
   ('owner', 'services', 'VCEAPXD'), ('owner', 'expenses', 'VCEAPXD'), ('owner', 'ledger', 'VCEAPXD'), ('owner', 'banking', 'VCEAPXD'),
   ('owner', 'hr', 'VCEAPXD'), ('owner', 'settings', 'VCEAPXD'), ('owner', 'billing', 'VCEAPXD'),
   ('admin', 'sales', 'VCEAPXD'), ('admin', 'invoices', 'VCEAPXD'), ('admin', 'customers', 'VCEXD'), ('admin', 'inventory', 'VCEAPXD'),
   ('admin', 'services', 'VCEAPXD'), ('admin', 'expenses', 'VCEAPX'), ('admin', 'ledger', 'VX'), ('admin', 'banking', 'VCEAP'),
   ('admin', 'hr', 'VCEAX'), ('admin', 'settings', 'VCED'), ('admin', 'billing', 'V'),
   ('accountant', 'sales', 'VX'), ('accountant', 'invoices', 'VAPX'), ('accountant', 'customers', 'VX'), ('accountant', 'inventory', 'VX'),
   ('accountant', 'services', 'V'), ('accountant', 'expenses', 'VAPX'), ('accountant', 'ledger', 'VCEAPX'), ('accountant', 'banking', 'VCEAPX'),
   ('accountant', 'hr', 'V'), ('accountant', 'settings', 'V'),
   ('bookkeeper', 'sales', 'VC'), ('bookkeeper', 'invoices', 'VCE'), ('bookkeeper', 'customers', 'VCE'), ('bookkeeper', 'inventory', 'VC'),
   ('bookkeeper', 'services', 'V'), ('bookkeeper', 'expenses', 'VCE'), ('bookkeeper', 'ledger', 'VCE'), ('bookkeeper', 'banking', 'VCE'),
   ('sales_manager', 'sales', 'VCEAP'), ('sales_manager', 'invoices', 'VCEP'), ('sales_manager', 'customers', 'VCEX'),
   ('sales_manager', 'inventory', 'V'), ('sales_manager', 'services', 'VCE'), ('sales_manager', 'expenses', 'VC'), ('sales_manager', 'ledger', 'V'),
   ('cashier', 'sales', 'VCP'), ('cashier', 'invoices', 'VCP'), ('cashier', 'customers', 'VC'), ('cashier', 'inventory', 'V'),
   ('cashier', 'services', 'VC'),
   ('inventory_manager', 'sales', 'V'), ('inventory_manager', 'inventory', 'VCEAPX'), ('inventory_manager', 'expenses', 'VC'),
   ('inventory_manager', 'ledger', 'V'),
   ('hr_manager', 'expenses', 'VC'), ('hr_manager', 'hr', 'VCEAPX'), ('hr_manager', 'settings', 'V'),
   ('service_staff', 'sales', 'VCP'), ('service_staff', 'invoices', 'VC'), ('service_staff', 'customers', 'VC'), ('service_staff', 'inventory', 'V'),
   ('service_staff', 'services', 'VCE'), ('service_staff', 'expenses', 'VC'), ('service_staff', 'hr', 'V'),
   ('auditor', 'sales', 'V'), ('auditor', 'invoices', 'V'), ('auditor', 'customers', 'V'), ('auditor', 'inventory', 'V'),
   ('auditor', 'services', 'V'), ('auditor', 'expenses', 'V'), ('auditor', 'ledger', 'VX'), ('auditor', 'banking', 'V'),
   ('auditor', 'hr', 'V'), ('auditor', 'settings', 'V'),
   -- Today's editor: records and posts sales, invoices, receipts and expenses, and voids invoices; manages customers,
   -- suppliers, catalogue, appointments and jobs; requests stock adjustments; posts native entries other than corrections.
   -- No staff, settings, HR or billing. At least today's rights: while the old role checks still apply alongside this one
   -- (until templates are assigned on screen), they keep editors exactly where they are today.
   ('editor_legacy', 'sales', 'VCEP'), ('editor_legacy', 'invoices', 'VCEPD'), ('editor_legacy', 'customers', 'VCE'),
   ('editor_legacy', 'inventory', 'VCE'), ('editor_legacy', 'services', 'VCE'), ('editor_legacy', 'expenses', 'VCEP'),
   ('editor_legacy', 'ledger', 'VCP'), ('editor_legacy', 'banking', 'V'),
   -- Today's viewer: reads the business's records and reports; no staff, settings, HR or billing.
   ('viewer_legacy', 'sales', 'V'), ('viewer_legacy', 'invoices', 'V'), ('viewer_legacy', 'customers', 'V'), ('viewer_legacy', 'inventory', 'V'),
   ('viewer_legacy', 'services', 'V'), ('viewer_legacy', 'expenses', 'V'), ('viewer_legacy', 'ledger', 'V'), ('viewer_legacy', 'banking', 'V')
  ) g(template, module, letters)
  JOIN authz.role_templates t ON t.code = g.template AND t.business_id IS NULL
 CROSS JOIN LATERAL regexp_split_to_table(g.letters, '') l;

-- Each membership carries its template. Until the screens assign templates (PR 4), the role column decides it.
ALTER TABLE public.memberships ADD COLUMN role_template_id uuid REFERENCES authz.role_templates(id);
UPDATE public.memberships m SET role_template_id = t.id
  FROM authz.role_templates t WHERE t.business_id IS NULL AND t.legacy_role = m.role::text;

CREATE FUNCTION authz.sync_role_template() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF TG_OP = 'INSERT' AND NEW.role_template_id IS NOT NULL THEN RETURN NEW; END IF;
 IF TG_OP = 'UPDATE' AND NEW.role::text IS NOT DISTINCT FROM OLD.role::text THEN RETURN NEW; END IF;
 SELECT id INTO NEW.role_template_id FROM authz.role_templates WHERE business_id IS NULL AND legacy_role = NEW.role::text;
 RETURN NEW;
END $$;
-- Fires on every update (the function ignores unchanged roles), so the role column's type can still be altered.
CREATE TRIGGER memberships_sync_role_template BEFORE INSERT OR UPDATE ON public.memberships
 FOR EACH ROW EXECUTE FUNCTION authz.sync_role_template();

-- The plan must include the module (Doc 08 §6 rule 4). HR needs a plan with staff records or payroll; unbilled
-- businesses keep everything, as elsewhere.
CREATE FUNCTION authz.plan_allows(p_business_id uuid, p_module text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT CASE p_module
   WHEN 'hr' THEN coalesce(platform.entitlement(p_business_id, 'module.payroll') IS DISTINCT FROM '"none"'::jsonb, true)
   ELSE true END;
$$;

-- The one permission decision (Doc 08 §6). True only for the signed-in caller's active membership in the business, when
-- the template plus grants minus revokes includes the permission (owners hold every permission), the outlet is within
-- the member's scope, and the plan includes the module. An unknown permission is a programming error, not a no.
CREATE FUNCTION authz.has_permission(p_business_id uuid, p_permission text, p_location_id uuid DEFAULT NULL) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE perm authz.permissions%ROWTYPE; m public.memberships%ROWTYPE; actor uuid := auth.uid();
BEGIN
 SELECT * INTO perm FROM authz.permissions WHERE code = p_permission;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_PERMISSION %', p_permission USING ERRCODE = '22023'; END IF;
 IF actor IS NULL THEN RETURN false; END IF;
 SELECT * INTO m FROM public.memberships WHERE business_id = p_business_id AND user_id = actor AND is_active;
 IF NOT FOUND THEN RETURN false; END IF;
 IF p_location_id IS NOT NULL AND NOT coalesce((to_jsonb(m)->>'all_locations')::boolean, true)
    AND (to_jsonb(m)->>'location_id')::uuid IS DISTINCT FROM p_location_id THEN
  RETURN false;
 END IF;
 IF NOT authz.plan_allows(p_business_id, perm.module) THEN RETURN false; END IF;
 IF m.role::text = 'owner' THEN RETURN true; END IF;
 IF EXISTS (SELECT FROM authz.membership_overrides WHERE business_id = p_business_id AND user_id = actor
            AND permission_code = p_permission AND effect = 'revoke') THEN
  RETURN false;
 END IF;
 RETURN EXISTS (SELECT FROM authz.role_template_permissions WHERE template_id = m.role_template_id AND permission_code = p_permission)
     OR EXISTS (SELECT FROM authz.membership_overrides WHERE business_id = p_business_id AND user_id = actor
                AND permission_code = p_permission AND effect = 'grant');
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA authz FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION authz.sync_role_template(), authz.plan_allows(uuid, text), authz.has_permission(uuid, text, uuid)
 FROM PUBLIC, anon, authenticated;
-- Policies, functions and the Python core call the decision function; nothing reads the tables directly.
GRANT USAGE ON SCHEMA authz TO authenticated, cacu_runtime;
GRANT EXECUTE ON FUNCTION authz.has_permission(uuid, text, uuid) TO authenticated, cacu_runtime;
