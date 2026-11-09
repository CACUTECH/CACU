"""Restricted direct Postgres transaction. No tenant state survives connection close."""
import json
import os
from cacu.accounting.session import MFA_MESSAGE, claims
from contextlib import contextmanager
from uuid import UUID
import psycopg
from fastapi import HTTPException
from cacu.database_tls import database_connect_options

@contextmanager
def authorized_transaction(user_id: UUID, business_id: UUID, write: bool = False):
    dsn = os.environ.get("CACU_DATABASE_URL")
    if not dsn:
        raise HTTPException(503, "Accounting database unavailable")
    # New connection per request: no client pool; prepared statements disabled for Supavisor.
    with psycopg.connect(dsn, **database_connect_options()) as connection:
        with connection.transaction():
            with connection.cursor() as cursor:
                cursor.execute("SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")
                role = cursor.fetchone()
                if not role or role[0] != "cacu_runtime" or role[1] or role[2]:
                    raise HTTPException(503, "Restricted runtime role required")
                cursor.execute("SELECT EXISTS (SELECT 1 FROM pg_class WHERE relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) AND relnamespace = 'public'::regnamespace)")
                if cursor.fetchone()[0]:
                    raise HTTPException(503, "Runtime must not own public tables")
                cursor.execute("SELECT set_config('request.jwt.claims', %s, true), set_config('cacu.business_id', %s, true), set_config('statement_timeout', '10000', true)",
                               (claims(user_id), str(business_id)))
                cursor.execute("SELECT accounting.lock_membership(%s, %s)", (business_id, user_id))
                membership = cursor.fetchone()
                if not membership or membership[0] not in {"owner", "admin", "editor", "viewer"}:
                    raise HTTPException(403, "Business membership required")
                cursor.execute("SELECT authz.mfa_ok(%s)", (business_id,))
                if not cursor.fetchone()[0]:
                    raise HTTPException(403, MFA_MESSAGE)
                if write and membership[0] not in {"owner", "admin", "editor"}:
                    raise HTTPException(403, "Insufficient permissions")
                yield cursor