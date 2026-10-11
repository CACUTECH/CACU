"""Offline migration generation only; never invoked by the API or startup."""
from pathlib import Path
from sqlalchemy.schema import CreateTable
from sqlalchemy.dialects import postgresql
from python_accounting.models import Base
import python_accounting.transactions

dialect = postgresql.dialect()
parts = ["-- Generated from tested python-accounting 1.0.1 metadata; review before applying.",
         "CREATE SCHEMA accounting;", "REVOKE ALL ON SCHEMA accounting FROM PUBLIC;",
         "SET LOCAL search_path = accounting, public, pg_catalog;",
         """CREATE FUNCTION accounting.authorized(tenant uuid) RETURNS boolean
         LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
         SELECT tenant = nullif(current_setting('cacu.business_id', true), '')::uuid
         AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.business_id=tenant
             AND m.user_id = (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid);
         $$;"""]
enums = {}
for table in Base.metadata.tables.values():
    for column in table.columns:
        if hasattr(column.type, "enums"):
            enums[column.type.name] = column.type.enums
for name, values in sorted(enums.items()):
    parts.append("CREATE TYPE accounting." + name + " AS ENUM (" + ",".join("'"+v.replace("'", "''")+"'" for v in values) + ");")
for table in Base.metadata.tables.values():
    parts.append(str(CreateTable(table, include_foreign_key_constraints=[]).compile(dialect=dialect)) + ";")
    parts.append(f"ALTER TABLE accounting.\"{table.name}\" ADD COLUMN business_id uuid NOT NULL DEFAULT nullif(current_setting('cacu.business_id', true), '')::uuid REFERENCES public.businesses(id);")
    parts.append(f"ALTER TABLE accounting.\"{table.name}\" ADD UNIQUE (id, business_id);")
    # Decimal headroom while preserving the library's four-decimal arithmetic.
    for c in table.columns:
        if getattr(c.type, "precision", None) == 13:
            parts.append(f"ALTER TABLE accounting.\"{table.name}\" ALTER COLUMN \"{c.name}\" TYPE numeric(19,4);")
for table in Base.metadata.tables.values():
    for constraint in table.foreign_key_constraints:
        # Composite ownership even for inheritance and nullable references.
        target = list(constraint.elements)[0].column.table.name
        col = list(constraint.elements)[0].parent.name
        parts.append(f"ALTER TABLE accounting.\"{table.name}\" ADD FOREIGN KEY (\"{col}\", business_id) REFERENCES accounting.\"{target}\" (id, business_id);")
for table in Base.metadata.tables.values():
    name = table.name
    parts.extend([f'ALTER TABLE accounting."{name}" ENABLE ROW LEVEL SECURITY;',
                  f'ALTER TABLE accounting."{name}" FORCE ROW LEVEL SECURITY;',
                  f'CREATE POLICY tenant_access ON accounting."{name}" TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));'])
Path('../supabase/migrations/20261011090000_python_accounting_schema.sql').write_text("\n\n".join(parts) + "\n")
