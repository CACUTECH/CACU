"""Full data export (Doc 10 E22 part 2; Doc 03 FR-192; Doc 11 POST /exports, GET /exports/{id}; Doc 14 SUB-10).

Someone with settings.export (the Owner, unless granted) asks; the export job builds one ZIP of CSV files: every
business table CACU keeps (sales, invoices, customers, stock, purchasing, staff, payroll, appointments and the rest),
a readable general ledger, and a README listing what is in it. Secrets (the sealed Paystack key, link tokens, hashes),
the ledger library's raw tables and internal bookkeeping maps are left out. The file is kept seven days and can be
downloaded only by someone with settings.export in that business (TEST-009).

The build reads in one read-only, repeatable-read transaction, so the files agree with each other, without the tenant
lock other writes take; the API reads the extra tables only while that export is running (accounting.exporting)."""
from contextlib import contextmanager
import csv
from datetime import date, datetime, timedelta
from decimal import Decimal
import hashlib
import io
import json
import os
import re
import zipfile
from uuid import UUID
import psycopg
from psycopg import sql
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict
from cacu.accounting.posting import raw
from cacu.accounting.session import PERMISSION_MESSAGE, allowed, claims
from cacu.database_tls import database_connect_options

KEEP_DAYS = 7
PER_DAY = 3
MAX_BYTES = 200 * 1024 * 1024
SYSTEM = 'system'
# The ledger library's own tables (replaced by general_ledger.csv), internal maps and request keys, secrets and tokens,
# raw gateway payloads, and logs that are not the business's records.
SKIP = {
    'accounting': {'account', 'assignment', 'balance', 'category', 'currency', 'entity', 'ledger', 'line_item', 'recyclable',
                   'recycled', 'reporting_period', 'tax', 'transaction', 'user', 'account_map', 'business_map', 'document_map',
                   'party_map', 'posting_requests', 'workflow_request', 'reversal_map', 'inventory_journal', 'payment_provider',
                   'payment_event', 'payment_link', 'data_export', 'cash_flow_classification'},
    'public': {'receipt_links', 'business_invitations', 'upload_events', 'payment_events', 'notification_preferences',
               'notification_settings', 'notifications', 'notification_logs'},
}
SECRET_COLUMN = re.compile(r'(secret|token|hash|cipher|password|signature|api_key|webhook)', re.I)


class ExportRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: UUID


def _row(r):
    return {'id': str(r.id), 'status': r.status, 'requested_at': r.requested_at.isoformat(),
            'finished_at': r.finished_at.isoformat() if r.finished_at else None,
            'expires_at': r.expires_at.isoformat() if r.expires_at else None, 'file_name': r.file_name,
            'size_bytes': r.size_bytes, 'manifest': r.manifest, 'error': r.error}


COLUMNS = 'id,status,requested_at,finished_at,expires_at,file_name,size_bytes,manifest,error'


def request_export(session, actor, data: ExportRequest):
    """Queues an export; the job builds it. A retry with the same key returns the same export."""
    tenant = str(session.business_id)
    if not allowed(session, 'settings.export'):
        raise HTTPException(403, PERMISSION_MESSAGE)
    old = raw(session, f'SELECT {COLUMNS} FROM accounting.data_export WHERE business_id=%s AND id=%s', (tenant, str(data.request_key))).first()
    if old:
        return _row(old)
    if raw(session, "SELECT 1 FROM accounting.data_export WHERE business_id=%s AND status IN ('queued','running')", (tenant,)).first():
        raise HTTPException(409, 'An export is already being prepared. It will be ready within the hour.')
    today = raw(session, "SELECT count(*) FROM accounting.data_export WHERE business_id=%s AND requested_at > now() - interval '1 day'", (tenant,)).scalar()
    if today >= PER_DAY:
        raise HTTPException(429, f'At most {PER_DAY} exports a day. Download one of the recent ones, or try again tomorrow.')
    raw(session, 'INSERT INTO accounting.data_export(business_id,id,requested_by) VALUES(%s,%s,%s)', (tenant, str(data.request_key), str(actor)))
    raw(session, "INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,'data_export_requested','{}'::jsonb)",
        (tenant, str(actor), str(data.request_key)))
    return read_export(session, data.request_key)


def list_exports(session, limit=10):
    rows = raw(session, f'SELECT {COLUMNS} FROM accounting.data_export WHERE business_id=%s ORDER BY requested_at DESC LIMIT %s',
               (str(session.business_id), limit)).all()
    return [_row(r) for r in rows]


def read_export(session, export_id: UUID):
    row = raw(session, f'SELECT {COLUMNS} FROM accounting.data_export WHERE business_id=%s AND id=%s', (str(session.business_id), str(export_id))).first()
    if not row:
        raise HTTPException(404, 'Export not found')
    return _row(row)


def download(session, actor, export_id: UUID):
    """The file, for someone with settings.export in this business, while it is kept (TEST-009)."""
    if not allowed(session, 'settings.export'):
        raise HTTPException(403, PERMISSION_MESSAGE)
    row = raw(session, 'SELECT status,file,file_name,expires_at FROM accounting.data_export WHERE business_id=%s AND id=%s',
              (str(session.business_id), str(export_id))).first()
    if not row:
        raise HTTPException(404, 'Export not found')
    if row.status == 'expired' or (row.expires_at and row.expires_at <= datetime.now(row.expires_at.tzinfo)):
        raise HTTPException(410, f'This export was deleted after {KEEP_DAYS} days. Prepare a new one.')
    if row.status != 'ready':
        raise HTTPException(409, 'This export is not ready yet.')
    raw(session, "INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,gen_random_uuid(),'data_export_downloaded',%s::jsonb)",
        (str(session.business_id), str(actor), json.dumps({'export_id': str(export_id)})))
    return row.file_name, bytes(row.file)


# The build --------------------------------------------------------------------------------------------------------------

def _dsn():
    dsn = os.environ.get('CACU_DATABASE_URL')
    if not dsn:
        raise HTTPException(503, 'Accounting database unavailable')
    return dsn.replace('postgresql+psycopg://', 'postgresql://', 1).replace('postgres://', 'postgresql://', 1)


def _connect():
    return psycopg.connect(_dsn(), **database_connect_options())


@contextmanager
def _runtime(actor: UUID, business_id: UUID, export_id: UUID | None = None, read_only=False):
    """A runtime-role transaction acting for the person who asked, as a server job; read-only builds see one snapshot."""
    with _connect() as connection:
        if read_only:
            connection.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
            connection.read_only = True
        with connection.transaction(), connection.cursor() as cursor:
            cursor.execute('SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user')
            if cursor.fetchone() != ('cacu_runtime', False, False):
                raise HTTPException(503, 'Restricted runtime role required')
            cursor.execute("SELECT set_config('request.jwt.claims', %s, true), set_config('cacu.business_id', %s, true), "
                           "set_config('cacu.export_id', %s, true), set_config('statement_timeout', '600000', true)",
                           (claims(actor, SYSTEM), str(business_id), str(export_id) if export_id else ''))
            cursor.execute("SELECT authz.has_permission(%s, 'settings.export')", (str(business_id),))
            if not cursor.fetchone()[0]:
                raise HTTPException(403, PERMISSION_MESSAGE)
            yield cursor


def _text(value):
    if value is None:
        return ''
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, default=str)
    if isinstance(value, Decimal):
        return format(value, 'f')
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, (bytes, memoryview)):
        return ''
    return str(value)


def _write(archive, name, header, rows):
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(header)
    count = 0
    for row in rows:
        writer.writerow([_text(v) for v in row])
        count += 1
    # A byte-order mark so Excel opens the naira sign and names correctly.
    archive.writestr(name, '﻿' + buffer.getvalue())
    return count


def tables(cursor):
    """Every business table the runtime can read now, less the ones left out, with the columns to export."""
    cursor.execute("""SELECT c.table_schema, c.table_name, array_agg(c.column_name::text ORDER BY c.ordinal_position)
      FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema IN ('public', 'accounting') AND t.table_type = 'BASE TABLE' AND c.data_type <> 'bytea'
        AND EXISTS (SELECT FROM information_schema.columns b WHERE b.table_schema = c.table_schema AND b.table_name = c.table_name AND b.column_name = 'business_id')
        AND has_table_privilege(format('%I.%I', c.table_schema, c.table_name), 'SELECT')
      GROUP BY 1, 2 ORDER BY 1, 2""")
    for schema, table, columns in cursor.fetchall():
        if table in SKIP.get(schema, set()):
            continue
        keep = [c for c in columns if not SECRET_COLUMN.search(c)]
        yield schema, table, keep


def build(actor: UUID, business_id: UUID, export_id: UUID) -> dict:
    """Builds and stores one export. Raises on failure; the job then marks it failed."""
    with _runtime(actor, business_id) as cursor:
        cursor.execute("UPDATE accounting.data_export SET status='running', started_at=now() WHERE business_id=%s AND id=%s AND status='queued'",
                       (str(business_id), str(export_id)))
        if cursor.rowcount != 1:
            return {'outcome': 'skipped'}
    started = datetime.utcnow()
    memory = io.BytesIO()
    counts = {}
    with _runtime(actor, business_id, export_id, read_only=True) as cursor, zipfile.ZipFile(memory, 'w', zipfile.ZIP_DEFLATED) as archive:
        for schema, table, columns in list(tables(cursor)):
            name = f'{schema}/{table}.csv'
            cursor.execute(sql.SQL('SELECT {} FROM {}.{} WHERE business_id = %s').format(
                sql.SQL(', ').join(map(sql.Identifier, columns)), sql.Identifier(schema), sql.Identifier(table)), (str(business_id),))
            counts[name] = _write(archive, name, columns, cursor)
        cursor.execute("""SELECT t.transaction_date::date, t.transaction_no, t.narration, a.code, a.name,
              CASE WHEN l.entry_type::text = 'DEBIT' THEN l.amount END, CASE WHEN l.entry_type::text = 'CREDIT' THEN l.amount END
            FROM accounting.ledger l JOIN accounting."transaction" t ON t.id = l.transaction_id
            JOIN accounting.account_map m ON m.business_id = l.business_id AND m.library_id = l.post_account_id
            JOIN public.accounts a ON a.business_id = m.business_id AND a.id = m.account_id
            WHERE l.business_id = %s ORDER BY t.transaction_date, t.id, l.id""", (str(business_id),))
        counts['general_ledger.csv'] = _write(archive, 'general_ledger.csv',
                                              ['date', 'transaction_no', 'narration', 'account_code', 'account_name', 'debit', 'credit'], cursor)
        if memory.tell() > MAX_BYTES:
            raise HTTPException(413, 'This export is too large to prepare here. Contact CACU support.')
        archive.writestr('README.txt', readme(started, counts))
    data = memory.getvalue()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, 'This export is too large to prepare here. Contact CACU support.')
    digest = hashlib.sha256(data).hexdigest()
    file_name = f'cacu-export-{started:%Y-%m-%d}-{str(export_id)[:8]}.zip'
    manifest = {'files': len(counts), 'rows': sum(counts.values()), 'counts': counts}
    with _runtime(actor, business_id) as cursor:
        cursor.execute("""UPDATE accounting.data_export SET status='ready', finished_at=now(), expires_at=now()+%s, file=%s, file_name=%s,
            size_bytes=%s, sha256=%s, manifest=%s::jsonb WHERE business_id=%s AND id=%s AND status='running'""",
                       (timedelta(days=KEEP_DAYS), data, file_name, len(data), digest, json.dumps(manifest), str(business_id), str(export_id)))
        if cursor.rowcount != 1:
            raise HTTPException(409, 'The export changed while it was being prepared')
    return {'outcome': 'ready', 'size_bytes': len(data), 'rows': manifest['rows']}


def readme(started, counts):
    lines = ['CACU data export', f'Prepared {started:%Y-%m-%d %H:%M} UTC.', '',
             'Each CSV file is one kind of record. Amounts are in naira. Dates are year-month-day.',
             'general_ledger.csv lists every posted entry with its account, debit and credit.',
             'Files under public/ hold your sales, invoices, customers, stock, staff and settings;',
             'files under accounting/ hold your books: payments, refunds, credit notes, bills, stock values and approvals.',
             'Passwords, payment keys and link tokens are never included.', '', 'Files and rows:']
    lines += [f'  {name}: {count}' for name, count in sorted(counts.items())]
    return '\n'.join(lines) + '\n'


def settle(business_id: UUID, export_id: UUID, status: str, error: str | None = None) -> bool:
    """Fails an export that cannot finish, or deletes a file past its seven days (runtime-only database function)."""
    with _connect() as connection, connection.transaction(), connection.cursor() as cursor:
        cursor.execute('SELECT accounting.export_settle(%s, %s, %s, %s)', (str(business_id), str(export_id), status, error))
        return bool(cursor.fetchone()[0])


def run_queue(apply: bool = False) -> dict:
    """The export job: builds waiting exports, fails stopped ones, deletes old files."""
    with _connect() as connection, connection.transaction(), connection.cursor() as cursor:
        cursor.execute('SELECT business_id, id, requested_by, kind FROM accounting.export_queue()')
        queue = cursor.fetchall()
    report = {'built': 0, 'failed': 0, 'expired': 0, 'waiting': len([q for q in queue if q[3] == 'build'])}
    if not apply:
        return report
    for business_id, export_id, actor, kind in queue:
        if kind == 'expire':
            report['expired'] += settle(business_id, export_id, 'expired')
            continue
        if kind == 'stale':
            report['failed'] += settle(business_id, export_id, 'failed', 'The export stopped part way. Prepare a new one.')
            continue
        try:
            if build(actor, business_id, export_id)['outcome'] == 'ready':
                report['built'] += 1
        except HTTPException as exc:
            settle(business_id, export_id, 'failed', exc.detail if exc.status_code < 500 else 'The export could not be prepared. Try again later.')
            report['failed'] += 1
        except Exception:  # noqa: BLE001 - one business's failure must not stop the others; details stay out of the record
            settle(business_id, export_id, 'failed', 'The export could not be prepared. Try again later.')
            report['failed'] += 1
    return report
