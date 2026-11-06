-- Permission model, part 4 (Doc 08 §5–§7, Doc 07 M-07/M-08): templates are chosen on screen.
--  * An invitation carries the template the invitee gets; an existing member can be given another template.
--  * Oga and Chairman businesses can build custom profiles (module.custom_roles).
--  * Nobody but the Owner can hand out a permission they do not hold themselves, so templates cannot escalate.
--  * While the old role checks still run alongside the permission, each assignment also sets the role that covers the
--    template (its "envelope"): view-only templates are viewers, templates that approve or manage staff, settings or HR
--    are admins, the rest editors. The remaining write policies that only checked the role now also check the
--    permission, so a wider envelope never opens more than the template allows.
SET LOCAL search_path = public, pg_catalog;

ALTER TABLE public.business_invitations ADD COLUMN IF NOT EXISTS role_template_id uuid REFERENCES authz.role_templates(id);

-- The role whose old checks cover everything the template allows.
CREATE OR REPLACE FUNCTION authz.envelope_role(p_template_id uuid) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT CASE
  WHEN t.code = 'owner' AND t.business_id IS NULL THEN 'owner'
  WHEN t.legacy_role IS NOT NULL THEN t.legacy_role  -- the compatibility templates keep exactly their role
  WHEN EXISTS (SELECT FROM authz.role_template_permissions p JOIN authz.permissions x ON x.code = p.permission_code
               WHERE p.template_id = t.id AND (x.action IN ('approve', 'delete')
                  OR (x.module IN ('settings', 'hr', 'billing') AND x.action <> 'view' AND x.action <> 'export')
                  OR (x.module = 'ledger' AND x.action IN ('edit', 'approve')))) THEN 'admin'
  WHEN EXISTS (SELECT FROM authz.role_template_permissions p JOIN authz.permissions x ON x.code = p.permission_code
               WHERE p.template_id = t.id AND x.action NOT IN ('view', 'export')) THEN 'editor'
  ELSE 'viewer' END
 FROM authz.role_templates t WHERE t.id = p_template_id;
$$;

-- A template chosen for a member is kept. Only a role change that does not also choose a template maps the role to
-- its compatibility template, as before. A new member takes the template on their invitation, if it has one.
CREATE OR REPLACE FUNCTION authz.sync_role_template() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
  IF NEW.role_template_id IS NOT NULL THEN RETURN NEW; END IF;
  IF to_regclass('auth.users') IS NOT NULL THEN
   SELECT i.role_template_id INTO NEW.role_template_id
     FROM public.business_invitations i JOIN auth.users u ON lower(u.email) = lower(i.email)
    WHERE u.id = NEW.user_id AND i.business_id = NEW.business_id AND i.status::text = 'invited'
      AND i.role_template_id IS NOT NULL AND i.role::text = NEW.role::text
    ORDER BY i.created_at DESC LIMIT 1;
   IF NEW.role_template_id IS NOT NULL THEN RETURN NEW; END IF;
  END IF;
 ELSIF NEW.role::text IS NOT DISTINCT FROM OLD.role::text
    OR NEW.role_template_id IS DISTINCT FROM OLD.role_template_id
    OR current_setting('authz.keep_template', true) = 'on' THEN  -- set by the template functions below
  RETURN NEW;
 END IF;
 SELECT id INTO NEW.role_template_id FROM authz.role_templates WHERE business_id IS NULL AND legacy_role = NEW.role::text;
 RETURN NEW;
END $$;

-- The caller may hand out this template: it belongs to the business (or is built in, but not Owner), and an actor
-- who is not the Owner holds every permission in it.
CREATE OR REPLACE FUNCTION authz.check_grantable(p_business_id uuid, p_template_id uuid) RETURNS authz.role_templates
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE t authz.role_templates%ROWTYPE; missing text;
BEGIN
 SELECT * INTO t FROM authz.role_templates WHERE id = p_template_id AND (business_id IS NULL OR business_id = p_business_id);
 IF NOT FOUND OR (t.code = 'owner' AND t.business_id IS NULL) THEN RAISE EXCEPTION 'TEMPLATE_INVALID' USING ERRCODE = '22023'; END IF;
 IF NOT authz.has_permission(p_business_id, 'billing.edit') THEN  -- only the Owner holds billing.edit
  SELECT min(permission_code) INTO missing FROM authz.role_template_permissions
   WHERE template_id = t.id AND NOT authz.has_permission(p_business_id, permission_code);
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'TEMPLATE_EXCEEDS_YOUR_ACCESS' USING ERRCODE = '42501'; END IF;
 END IF;
 RETURN t;
END $$;

-- Every template the business can use, what each allows and who holds it, for the team screens.
CREATE OR REPLACE FUNCTION public.role_templates(p_business_id uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 PERFORM authz.require(p_business_id, 'settings.view');
 RETURN jsonb_build_object(
  'custom_allowed', coalesce(platform.entitlement(p_business_id, 'module.custom_roles') = 'true'::jsonb, true),
  'templates', coalesce((SELECT jsonb_agg(jsonb_build_object(
     'id', t.id, 'code', t.code, 'name', t.name, 'builtin', t.is_builtin, 'legacy', t.code LIKE '%\_legacy',
     'role', authz.envelope_role(t.id),
     'permissions', coalesce((SELECT jsonb_agg(p.permission_code ORDER BY p.permission_code) FROM authz.role_template_permissions p
                               WHERE p.template_id = t.id), '[]'::jsonb),
     'members', (SELECT count(*) FROM public.memberships m WHERE m.business_id = p_business_id AND m.role_template_id = t.id AND m.is_active))
     ORDER BY t.is_builtin DESC, t.name)
    FROM authz.role_templates t WHERE t.business_id IS NULL OR t.business_id = p_business_id), '[]'::jsonb),
  'assigned', coalesce((SELECT jsonb_object_agg(m.user_id, m.role_template_id) FROM public.memberships m
                         WHERE m.business_id = p_business_id), '{}'::jsonb));
END $$;

-- Gives an existing member another template (not the Owner, not yourself).
CREATE OR REPLACE FUNCTION public.assign_role_template(p_business_id uuid, p_user_id uuid, p_template_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid; t authz.role_templates%ROWTYPE; m public.memberships%ROWTYPE; envelope text; result jsonb;
BEGIN
 PERFORM authz.require(p_business_id, 'settings.edit');
 actor := management_private.authorize(p_business_id, ARRAY['owner', 'admin'], true);
 t := authz.check_grantable(p_business_id, p_template_id);
 SELECT * INTO m FROM public.memberships WHERE business_id = p_business_id AND user_id = p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACTIVE_BUSINESS_MEMBER_REQUIRED' USING ERRCODE = '22023'; END IF;
 IF m.role::text = 'owner' THEN RAISE EXCEPTION 'OWNER_PERMISSION_REQUIRED' USING ERRCODE = '42501'; END IF;
 IF p_user_id = actor THEN RAISE EXCEPTION 'CANNOT_CHANGE_OWN_ACCESS' USING ERRCODE = '42501'; END IF;
 envelope := authz.envelope_role(t.id);
 PERFORM set_config('authz.keep_template', 'on', true);
 UPDATE public.memberships SET role = envelope::public.membership_role, role_template_id = t.id, version = version + 1,
        all_locations = CASE WHEN envelope = 'admin' THEN true ELSE all_locations END,
        location_id = CASE WHEN envelope = 'admin' THEN NULL ELSE location_id END
  WHERE id = m.id RETURNING to_jsonb(memberships.*) INTO result;
 PERFORM set_config('authz.keep_template', 'off', true);
 INSERT INTO management_private.audit(business_id, actor_id, event, record_id, details)
 VALUES (p_business_id, actor, 'member.template', p_user_id, jsonb_build_object('template', t.code));
 RETURN result || jsonb_build_object('template_id', t.id);
END $$;

-- Invites someone with a template: the invitation is created as before, with the template's role, and remembers the template.
CREATE OR REPLACE FUNCTION public.invite_member(p_business_id uuid, p_request_key uuid, p_data jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE t authz.role_templates%ROWTYPE; envelope text; result jsonb;
BEGIN
 PERFORM authz.require(p_business_id, 'settings.create');
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR nullif(p_data->>'template_id', '') IS NULL THEN
  RAISE EXCEPTION 'INVALID_INVITATION' USING ERRCODE = '22023';
 END IF;
 t := authz.check_grantable(p_business_id, (p_data->>'template_id')::uuid);
 envelope := authz.envelope_role(t.id);
 IF envelope NOT IN ('admin', 'editor', 'viewer') THEN RAISE EXCEPTION 'TEMPLATE_INVALID' USING ERRCODE = '22023'; END IF;
 result := public.management_write(p_business_id, p_request_key, 'invitation.create', NULL, NULL,
                                   (p_data - 'template_id') || jsonb_build_object('role', envelope));
 UPDATE public.business_invitations SET role_template_id = t.id WHERE id = (result->>'id')::uuid AND business_id = p_business_id;
 RETURN result || jsonb_build_object('role_template_id', t.id);
END $$;

-- Custom profiles (Oga and Chairman). Billing stays with the Owner, so a profile cannot include billing changes.
CREATE OR REPLACE FUNCTION public.save_role_template(p_business_id uuid, p_template_id uuid, p_name text, p_permissions text[]) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid; t authz.role_templates%ROWTYPE; v_name text := btrim(coalesce(p_name, '')); perms text[] := coalesce(p_permissions, '{}');
 envelope text;
BEGIN
 PERFORM authz.require(p_business_id, 'settings.edit');
 actor := management_private.authorize(p_business_id, ARRAY['owner', 'admin'], true);
 IF NOT coalesce(platform.entitlement(p_business_id, 'module.custom_roles') = 'true'::jsonb, true) THEN
  RAISE EXCEPTION 'PLAN_LIMIT module.custom_roles' USING ERRCODE = '42501';
 END IF;
 IF length(v_name) NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'INVALID_NAME' USING ERRCODE = '22023'; END IF;
 IF cardinality(perms) = 0 OR EXISTS (SELECT FROM unnest(perms) p WHERE p NOT IN (SELECT code FROM authz.permissions))
    OR EXISTS (SELECT FROM unnest(perms) p WHERE p LIKE 'billing.%' AND p <> 'billing.view') THEN
  RAISE EXCEPTION 'INVALID_PERMISSIONS' USING ERRCODE = '22023';
 END IF;
 IF NOT authz.has_permission(p_business_id, 'billing.edit')
    AND EXISTS (SELECT FROM unnest(perms) p WHERE NOT authz.has_permission(p_business_id, p)) THEN
  RAISE EXCEPTION 'TEMPLATE_EXCEEDS_YOUR_ACCESS' USING ERRCODE = '42501';
 END IF;
 IF EXISTS (SELECT FROM authz.role_templates WHERE (business_id IS NULL OR business_id = p_business_id)
            AND lower(name) = lower(v_name) AND id IS DISTINCT FROM p_template_id) THEN
  RAISE EXCEPTION 'DUPLICATE_TEMPLATE_NAME' USING ERRCODE = '23505';
 END IF;
 IF p_template_id IS NULL THEN
  INSERT INTO authz.role_templates(business_id, code, name, is_builtin)
  VALUES (p_business_id, 'custom_' || translate(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12), '0123456789', 'ghijklmnop'), v_name, false) RETURNING * INTO t;
 ELSE
  SELECT * INTO t FROM authz.role_templates WHERE id = p_template_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TEMPLATE_INVALID' USING ERRCODE = '22023'; END IF;
  UPDATE authz.role_templates SET name = v_name WHERE id = t.id;
  DELETE FROM authz.role_template_permissions WHERE template_id = t.id;
 END IF;
 INSERT INTO authz.role_template_permissions(template_id, permission_code) SELECT t.id, p FROM unnest(perms) p ON CONFLICT DO NOTHING;
 -- People already on the profile get its new rights now, with the role that covers them.
 envelope := authz.envelope_role(t.id);
 PERFORM set_config('authz.keep_template', 'on', true);
 UPDATE public.memberships SET role = envelope::public.membership_role, version = version + 1,
        all_locations = CASE WHEN envelope = 'admin' THEN true ELSE all_locations END,
        location_id = CASE WHEN envelope = 'admin' THEN NULL ELSE location_id END
  WHERE business_id = p_business_id AND role_template_id = t.id AND role::text <> 'owner' AND role::text <> envelope;
 PERFORM set_config('authz.keep_template', 'off', true);
 INSERT INTO management_private.audit(business_id, actor_id, event, record_id, details)
 VALUES (p_business_id, actor, 'template.save', t.id, jsonb_build_object('name', v_name, 'permissions', to_jsonb(perms)));
 RETURN jsonb_build_object('id', t.id, 'name', v_name, 'permissions', to_jsonb(perms), 'role', envelope);
END $$;

CREATE OR REPLACE FUNCTION public.delete_role_template(p_business_id uuid, p_template_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid;
BEGIN
 PERFORM authz.require(p_business_id, 'settings.delete');
 actor := management_private.authorize(p_business_id, ARRAY['owner', 'admin'], true);
 PERFORM FROM authz.role_templates WHERE id = p_template_id AND business_id = p_business_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'TEMPLATE_INVALID' USING ERRCODE = '22023'; END IF;
 IF EXISTS (SELECT FROM public.memberships WHERE role_template_id = p_template_id)
    OR EXISTS (SELECT FROM public.business_invitations WHERE role_template_id = p_template_id AND status::text = 'invited') THEN
  RAISE EXCEPTION 'TEMPLATE_IN_USE' USING ERRCODE = '23503';
 END IF;
 DELETE FROM authz.role_template_permissions WHERE template_id = p_template_id;
 DELETE FROM authz.role_templates WHERE id = p_template_id;
 INSERT INTO management_private.audit(business_id, actor_id, event, record_id) VALUES (p_business_id, actor, 'template.delete', p_template_id);
END $$;

REVOKE ALL ON FUNCTION authz.envelope_role(uuid), authz.check_grantable(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.role_templates(uuid), public.assign_role_template(uuid, uuid, uuid), public.invite_member(uuid, uuid, jsonb),
 public.save_role_template(uuid, uuid, text, text[]), public.delete_role_template(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.role_templates(uuid), public.assign_role_template(uuid, uuid, uuid), public.invite_member(uuid, uuid, jsonb),
 public.save_role_template(uuid, uuid, text, text[]), public.delete_role_template(uuid, uuid) TO authenticated;

-- The remaining write policies that only checked the role: the existing rule AND the permission (as in part 2).
DO $policies$
DECLARE target record; pol record; using_clause text; check_clause text; perm text;
BEGIN
 FOR target IN SELECT * FROM (VALUES
   ('businesses', 'settings', 'id'), ('storefront_settings', 'settings', 'business_id'), ('memberships', 'settings', 'business_id'),
   ('employees', 'hr', 'business_id'), ('attendance', 'hr', 'business_id'), ('payroll_runs', 'hr', 'business_id'),
   ('payslips', 'hr', 'business_id'), ('accounts', 'ledger', 'business_id'), ('financial_transactions', 'ledger', 'business_id'),
   ('journal_entries', 'ledger', 'business_id'), ('journal_lines', 'ledger', 'business_id'),
   ('invoice_items', 'invoices', 'business_id'), ('transaction_items', 'sales', 'business_id')
  ) t(tab, module, key)
 LOOP
  FOR pol IN SELECT policyname, cmd, qual, with_check FROM pg_policies
              WHERE schemaname = 'public' AND tablename = target.tab AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
                AND policyname NOT LIKE 'accounting_%' LOOP
   CONTINUE WHEN coalesce(pol.qual, '') || coalesce(pol.with_check, '') LIKE '%authz.has_permission%';
   perm := target.module || '.' || CASE pol.cmd WHEN 'INSERT' THEN 'create' WHEN 'UPDATE' THEN 'edit' ELSE 'delete' END;
   using_clause := CASE WHEN pol.qual IS NOT NULL THEN format(' USING ((%s) AND authz.has_permission(%I, %L))', pol.qual, target.key, perm) ELSE '' END;
   check_clause := CASE WHEN pol.with_check IS NOT NULL THEN format(' WITH CHECK ((%s) AND authz.has_permission(%I, %L))', pol.with_check, target.key, perm) ELSE '' END;
   EXECUTE format('ALTER POLICY %I ON public.%I', pol.policyname, target.tab) || using_clause || check_clause;
  END LOOP;
 END LOOP;
END
$policies$;
