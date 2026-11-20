"""Full data export (Doc 10 E22 part 2, FR-192, TEST-009): asked for by someone with settings.export, built by the job
into one ZIP of CSV files with a readable general ledger and no secrets, downloadable only in that business while
kept, deleted after seven days. The API reads the extra tables only inside a running export."""
import csv
import io
import json
import zipfile
from datetime import datetime, timedelta, timezone
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting import exports
from cacu.accounting.exports import ExportRequest, download, list_exports, read_export, request_export, run_queue
from cacu.accounting.session import claims
from test_corrections_postgres import live, call, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


@pytest.fixture
def runtime(live, monkeypatch):
    """The job connects as the API's restricted role."""
    def connect():
        connection = psycopg.connect(URL, autocommit=True)
        connection.execute('SET ROLE cacu_runtime')
        connection.autocommit = False
        return connection
    monkeypatch.setattr(exports, '_connect', connect)
    # The test schema turns on row-level security for memberships only after the migrations, so the migration skipped
    # it; production has it on, and the migration adds this policy there.
    with psycopg.connect(URL) as c:
        if not c.execute("SELECT 1 FROM pg_policies WHERE tablename='memberships' AND policyname='export_read'").fetchone():
            c.execute('CREATE POLICY export_read ON public.memberships FOR SELECT TO cacu_runtime USING (accounting.exporting(business_id))')
    return live


def ask(live, who='owner', key=None):
    return call(live, who, lambda s, a: request_export(s, a, ExportRequest(request_key=key or uuid4())))


def files(content):
    archive = zipfile.ZipFile(io.BytesIO(content))
    return {name: archive.read(name).decode('utf-8-sig') for name in archive.namelist()}


def rows(text):
    return list(csv.DictReader(io.StringIO(text)))


def test_the_owner_exports_everything_but_secrets_and_only_that_business_can_download_it(runtime):
    live = runtime
    with psycopg.connect(URL) as c:  # a staff record the API could not read before
        c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': str(live.people['owner'])}),))
        c.execute("INSERT INTO parked_sales(business_id,label,items,created_by) VALUES(%s,'Ada, blue cap','[{\"item\":1}]',%s)",
                  (live.business, live.people['owner']))
    with pytest.raises(HTTPException) as admin:
        ask(live, 'admin')  # settings.export: the Owner unless granted
    assert admin.value.status_code == 403
    key = uuid4()
    queued = ask(live, key=key)
    assert queued['status'] == 'queued' and ask(live, key=key) == queued  # a retry asks once
    with pytest.raises(HTTPException, match='already being prepared'):
        ask(live)
    assert run_queue(apply=False) == {'built': 0, 'failed': 0, 'expired': 0, 'waiting': 1}
    assert run_queue(apply=True)['built'] == 1
    ready = call(live, 'owner', lambda s, a: read_export(s, key))
    assert ready['status'] == 'ready' and ready['file_name'].startswith('cacu-export-') and ready['expires_at']
    name, content = call(live, 'owner', lambda s, a: download(s, a, key))
    assert name == ready['file_name'] and len(content) == ready['size_bytes']
    got = files(content)
    assert 'README.txt' in got and 'general_ledger.csv' in got and 'public/customers.csv' in got
    assert 'Ada Stores' in got['public/customers.csv'] and 'Ada, blue cap' in got['public/parked_sales.csv']
    assert len(rows(got['public/memberships.csv'])) >= 4  # every member, not only the person who asked
    ledger = rows(got['general_ledger.csv'])
    assert ledger and sum(float(r['debit'] or 0) for r in ledger) == pytest.approx(sum(float(r['credit'] or 0) for r in ledger))
    assert not any(n.startswith(('accounting/payment_provider', 'accounting/ledger', 'accounting/posting_requests', 'public/receipt_links'))
                   for n in got)
    headers = {n: next(csv.reader(io.StringIO(t))) for n, t in got.items() if n.endswith('.csv')}
    assert not [(n, c) for n, h in headers.items() for c in h if exports.SECRET_COLUMN.search(c)]
    assert ready['manifest']['counts']['public/customers.csv'] >= 2

    # TEST-009: a member of another business, or someone without settings.export, gets nothing.
    with pytest.raises(HTTPException) as outsider:
        call(live, 'outsider', lambda s, a: download(s, a, key))
    assert outsider.value.status_code in (403, 404)
    with pytest.raises(HTTPException) as admin:
        call(live, 'admin', lambda s, a: download(s, a, key))
    assert admin.value.status_code == 403
    assert [e['id'] for e in call(live, 'owner', lambda s, a: list_exports(s))] == [str(key)]


def test_the_api_reads_the_extra_tables_only_inside_a_running_export(runtime):
    live = runtime
    with psycopg.connect(URL) as c:
        c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': str(live.people['owner'])}),))
        c.execute("INSERT INTO parked_sales(business_id,label,items,created_by) VALUES(%s,'Held','[{\"item\":1}]',%s)", (live.business, live.people['owner']))
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE cacu_runtime')
        c.execute("SELECT set_config('request.jwt.claims',%s,true),set_config('cacu.business_id',%s,true)", (claims(live.people['owner'], 'system'), str(live.business)))
        assert c.execute('SELECT count(*) FROM parked_sales').fetchone()[0] == 0
        c.execute("SELECT set_config('cacu.export_id',%s,true)", (str(uuid4()),))  # an export id that is not running
        assert c.execute('SELECT count(*) FROM parked_sales').fetchone()[0] == 0


def test_limits_expiry_and_stopped_runs(runtime):
    live = runtime
    first = ask(live)['id']
    run_queue(apply=True)
    with psycopg.connect(URL) as c:  # seven days later
        c.execute('ALTER TABLE accounting.data_export DISABLE TRIGGER data_export_moves')
        c.execute('UPDATE accounting.data_export SET expires_at=now()-%s::interval WHERE id=%s', ('1 minute', first))
        c.execute('ALTER TABLE accounting.data_export ENABLE TRIGGER data_export_moves')
    with pytest.raises(HTTPException) as gone:
        call(live, 'owner', lambda s, a: download(s, a, first))
    assert gone.value.status_code == 410
    assert run_queue(apply=True)['expired'] == 1
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT status, file IS NULL FROM accounting.data_export WHERE id=%s', (first,)).fetchone() == ('expired', True)
        with pytest.raises(psycopg.errors.CheckViolation, match='EXPORT_STATE_INVALID'):
            c.execute("UPDATE accounting.data_export SET status='ready' WHERE id=%s", (first,))
    stopped = uuid4()
    with psycopg.connect(URL) as c:  # a run cancelled part way
        c.execute("INSERT INTO accounting.data_export(business_id,id,requested_by,status,started_at) VALUES(%s,%s,%s,'running',%s)",
                  (live.business, stopped, live.people['owner'], datetime.now(timezone.utc) - timedelta(hours=2)))
    assert run_queue(apply=True)['failed'] == 1
    assert call(live, 'owner', lambda s, a: read_export(s, stopped))['error'] == 'The export stopped part way. Prepare a new one.'
    ask(live)
    run_queue(apply=True)
    with pytest.raises(HTTPException, match='At most 3 exports a day'):
        ask(live)  # three asked today
    assert json.loads(claims(live.people['owner'], 'system'))['aal'] == 'system'
