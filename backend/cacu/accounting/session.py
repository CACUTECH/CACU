"""Library sessions join an externally owned transaction; commit means flush."""
from contextlib import contextmanager
import json
import os
from uuid import UUID
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.pool import NullPool
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

@contextmanager
def library_transaction(user_id: UUID, business_id: UUID, write=False):
    dsn = os.environ.get('CACU_DATABASE_URL')
    if not dsn:
        raise HTTPException(503, 'Accounting database unavailable')
    if dsn.startswith('postgres://'):
        dsn = dsn.replace('postgres://', 'postgresql://', 1)
    if dsn.startswith('postgresql://'):
        dsn = dsn.replace('postgresql://', 'postgresql+psycopg://', 1)
    engine = create_engine(dsn, poolclass=NullPool, hide_parameters=True,
                          connect_args={'sslmode': 'verify-full', 'prepare_threshold': None, 'connect_timeout': 10})
    try:
        with engine.begin() as connection:
            role = connection.exec_driver_sql('SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user').one()
            if role != ('cacu_runtime', False, False):
                raise HTTPException(503, 'Restricted accounting runtime required')
            owns = connection.exec_driver_sql("SELECT EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND n.nspname IN ('public','accounting'))").scalar()
            if owns:
                raise HTTPException(503, 'Runtime must not own accounting or source tables')
            connection.exec_driver_sql("SELECT set_config('request.jwt.claims', %s, true), set_config('cacu.business_id', %s, true), set_config('search_path', 'accounting,public,pg_catalog', true), set_config('statement_timeout', '15000', true)",
                                       (json.dumps({'sub': str(user_id), 'role': 'authenticated'}), str(business_id)))
            # Locks the tenant for numbering, durable replay, and payment allocation.
            # All accounting writes use this same lock, even with different request keys.
            connection.exec_driver_sql('SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))', (str(business_id),))
            member = connection.exec_driver_sql('SELECT accounting.lock_membership(%s, %s)', (str(business_id), str(user_id))).scalar()
            if member not in {'owner', 'admin', 'editor', 'viewer'} or (write and member == 'viewer'):
                raise HTTPException(403, 'Business permission required')
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
