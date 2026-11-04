-- Owner-confirmed plan limits (4 November 2026), replacing the Doc 14 proposals. Each change is logged in
-- platform.config_changes by the existing audit trigger. JSON null means unlimited.
--   AI questions a month: General 30, Oga 100, Chairman unlimited.
--   Outlets:              General 1,  Oga 5,   Chairman 20.
--   Users:                General 2,  Oga 5,   Chairman 50.
-- Catalogue items (300, 3,000, unlimited) are unchanged.
SET LOCAL search_path = public, pg_catalog;

UPDATE platform.plan_entitlements e SET value = v.value, updated_at = now()
  FROM (VALUES ('BASE', 'ai.queries_per_month', '30'::jsonb), ('GROW', 'ai.queries_per_month', '100'), ('TOP', 'ai.queries_per_month', 'null'),
               ('BASE', 'outlets.max', '1'), ('GROW', 'outlets.max', '5'), ('TOP', 'outlets.max', '20'),
               ('BASE', 'users.max', '2'), ('GROW', 'users.max', '5'), ('TOP', 'users.max', '50')) v(plan_code, key, value)
 WHERE e.plan_code = v.plan_code AND e.key = v.key AND e.value IS DISTINCT FROM v.value;
