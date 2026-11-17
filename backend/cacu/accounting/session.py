"""Library sessions join an externally owned transaction; commit means flush."""
from contextlib import contextmanager
import json
import os
from uuid import UUID
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.pool import NullPool
from cacu.database_tls import database_connect_options
from python_accounting.database.session import AccountingSession
from python_accounting.models import Entity
import python_accounting.transactions  # register concrete polymorphic models

class AtomicAccountingSession(AccountingSession):
    def _set_reporting_period(self):
        # Runtime posting must not open or transition fiscal periods implicitly.
        # The explicit provisioning tool uses a separately privileged connection.
        if getattr(self, 'business_id', None) is not None:
            raise HTTPException(409, 'A reviewed current reporting period is required')
        return super()._set_reporting_period()

    def commit(self):
        # Upstream posting calls commit per ledger pair. Only the outer connection
        # may commit; otherwise document/stock/audit failures would leave postings.
        self.flush()

def take_write_slot(engine, user_id: UUID, business_id: UUID, level: str | None = None):
    """API-012: count this write against the user's and the business's per-minute allowance. It commits on its own,
    before the write's transaction, so refused and failed writes count too."""
    with engine.begin() as connection:
        connection.exec_driver_sql("SELECT set_config('request.jwt.claims', %s, true), set_config('cacu.business_id', %s, true)",
                                   (claims(user_id, level), str(business_id)))
        wait = connection.exec_driver_sql('SELECT accounting.take_write_slot(%s)', (str(business_id),)).scalar()
    if wait:
        raise HTTPException(429, f'Too many changes in a short time. Try again in {wait} seconds.', headers={'Retry-After': str(wait)})

PERMISSION_MESSAGE = 'You do not have permission to do this in this business. Ask the business owner.'
MFA_MESSAGE = 'Finish two-step sign-in first: enter the code from your authenticator app, or set one up if your plan requires it.'


def claims(user_id: UUID, level: str | None = None) -> str:
    """The request claims the database reads: who is acting, and the session's assurance level (SEC-014). level is
    'system' only for the API's own server jobs acting for a staff member without a browser session."""
    from cacu.auth.session import session_level
    return json.dumps({'sub': str(user_id), 'role': 'authenticated', 'aal': level or session_level.get()})


def allowed(session, permission: str) -> bool:
    """Whether the signed-in member holds the permission in the session's business (Doc 08 §6)."""
    return bool(session.connection().exec_driver_sql('SELECT authz.has_permission(%s, %s)', (str(session.business_id), permission)).scalar())
SUPPORT_MESSAGE = 'CACU support access is read-only.'
CLOSED_MESSAGE = 'This business is closed, so its records are read-only. The owner can export them, or reopen the business within 90 days.'
READ_ONLY_MESSAGE = 'Your workspace is read-only until the subscription is paid. You can still record payments received and export.'

@contextmanager
def library_transaction(user_id: UUID, business_id: UUID, write=False, while_read_only=False, permission: str | None = None, level: str | None = None):
    """while_read_only: the write is one a suspended business may still make (Doc 14 SUB-10), such as a receipt.
    permission: the Doc 08 permission the action needs (module.action), checked by authz.has_permission in this
    transaction, alongside the role check above, until every module has switched (M-08).
    level: 'system' for the API's server jobs (see claims); otherwise the request's own session level."""
    dsn = os.environ.get('CACU_DATABASE_URL')
    if not dsn:
        raise HTTPException(503, 'Accounting database unavailable')
    if dsn.startswith('postgres://'):
        dsn = dsn.replace('postgres://', 'postgresql://', 1)
    if dsn.startswith('postgresql://'):
        dsn = dsn.replace('postgresql://', 'postgresql+psycopg://', 1)
    engine = create_engine(dsn, poolclass=NullPool, hide_parameters=True,
                          connect_args=database_connect_options())
    try:
        if write:
            take_write_slot(engine, user_id, business_id, level)
        with engine.begin() as connection:
            role = connection.exec_driver_sql('SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user').one()
            if role != ('cacu_runtime', False, False):
                raise HTTPException(503, 'Restricted accounting runtime required')
            owns = connection.exec_driver_sql("SELECT EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND n.nspname IN ('public','accounting'))").scalar()
            if owns:
                raise HTTPException(503, 'Runtime must not own accounting or source tables')
            connection.exec_driver_sql("SELECT set_config('request.jwt.claims', %s, true), set_config('cacu.business_id', %s, true), set_config('search_path', 'accounting,public,pg_catalog', true), set_config('statement_timeout', '15000', true)",
                                       (claims(user_id, level), str(business_id)))
            # Locks the tenant for numbering, durable replay, and payment allocation.
            # All accounting writes use this same lock, even with different request keys.
            connection.exec_driver_sql('SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))', (str(business_id),))
            member = connection.exec_driver_sql('SELECT accounting.lock_membership(%s, %s)', (str(business_id), str(user_id))).scalar()
            # 'support': CACU support with an opened, owner-granted case (E22 part 4); read-only, like a viewer.
            if member not in {'owner', 'admin', 'editor', 'viewer', 'support'} or (write and member in {'viewer', 'support'}):
                raise HTTPException(403, SUPPORT_MESSAGE if write and member == 'support' else 'Business permission required')
            if not connection.exec_driver_sql('SELECT authz.mfa_ok(%s)', (str(business_id),)).scalar():
                raise HTTPException(403, MFA_MESSAGE)
            if permission and not connection.exec_driver_sql('SELECT authz.has_permission(%s, %s)', (str(business_id), permission)).scalar():
                raise HTTPException(403, PERMISSION_MESSAGE)
            if write and not while_read_only and not connection.exec_driver_sql('SELECT platform.writes_allowed(%s)', (str(business_id),)).scalar():
                closed = connection.exec_driver_sql('SELECT platform.is_closed(%s)', (str(business_id),)).scalar()
                raise HTTPException(403, CLOSED_MESSAGE if closed else READ_ONLY_MESSAGE)
            mapping = connection.exec_driver_sql("SELECT entity_id, timezone FROM accounting.business_map WHERE business_id=%s AND state='active'", (str(business_id),)).first()
            if not mapping:
                raise HTTPException(409, 'Accounting cutover has not been reconciled for this business')
            session = AtomicAccountingSession(bind=connection, info={'ignore_isolation': False, 'include_deleted': False})
            try:
                session.entity = session.get(Entity, mapping.entity_id)
                if not session.entity:
                    raise HTTPException(409, 'Accounting entity mapping unavailable')
                if session.entity.multi_currency or not session.entity.currency or session.entity.currency.code != 'NGN':
                    raise HTTPException(409, 'This reporting policy supports single-currency NGN entities')
                session.business_id = business_id
                session.business_timezone = mapping.timezone
                yield session
                session.flush()
            finally:
                session.close()
    finally:
        engine.dispose()
