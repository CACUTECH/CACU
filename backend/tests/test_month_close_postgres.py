"""Month close and reopen (Doc 09 periods and checklist, FR-135; Doc 10 E14 R3 part 1): months close in order once
ended; closing is refused while the books do not balance or a subledger differs from its control account; other
steps are ticked or explained; a closed month takes no posting by any route; only the Owner reopens, with a reason."""
import json
from datetime import timedelta
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy.pool import NullPool
from cacu.accounting import session as sessions
from cacu.accounting.periods import CloseMonth, ReopenMonth, close_month, month_end, month_start, overview, reopen_month
from cacu.accounting.workflows import expense_create
from test_corrections_postgres import live, call, expense, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_activation_postgres import TODAY

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
THIS_MONTH = month_start(TODAY)
LAST_MONTH = month_start(THIS_MONTH - timedelta(days=1))
EARLIER_MONTH = month_start(LAST_MONTH - timedelta(days=1))
ALL_TICKED = CloseMonth(acknowledgements={k: {'done': True} for k in ('bank_cash', 'stock_count', 'accruals', 'review')})


def started(live, month):
    """The books started at the beginning of an earlier month (the fixture starts them today)."""
    with psycopg.connect(URL) as c:
        c.execute('UPDATE accounting.business_map SET cutover_date=%s WHERE business_id=%s', (month, live.business))
    return live


def key(month):
    return month.strftime('%Y-%m')


def test_months_close_in_order_after_they_end_with_every_step_answered(live):
    started(live, EARLIER_MONTH)
    view = call(live, 'viewer', lambda s, a: overview(s))
    assert [m['month'] for m in view['months']] == [LAST_MONTH.isoformat(), EARLIER_MONTH.isoformat()]  # newest first; not this month
    assert view['next_to_close'] == EARLIER_MONTH.isoformat() and view['latest_closed'] is None
    steps = {s['key']: s for s in view['checklist']}
    assert all(steps[k]['passed'] for k in ('trial_balance', 'receivables', 'payables', 'stock'))
    assert steps['bank_cash']['needs_answer'] and not steps['trial_balance']['needs_answer']

    with pytest.raises(HTTPException, match='Close .* first. Months close in order'):
        call(live, 'owner', lambda s, a: close_month(s, a, key(LAST_MONTH), ALL_TICKED))
    with pytest.raises(HTTPException, match='only after it has ended'):
        call(live, 'owner', lambda s, a: close_month(s, a, key(THIS_MONTH), ALL_TICKED))
    with pytest.raises(HTTPException, match='Tick or explain: Bank and cash'):
        call(live, 'owner', lambda s, a: close_month(s, a, key(EARLIER_MONTH), CloseMonth()))
    explained = CloseMonth(acknowledgements={**ALL_TICKED.acknowledgements, 'bank_cash': {'done': False, 'note': 'No bank account yet; cash counted'}})
    closed = call(live, 'admin', lambda s, a: close_month(s, a, key(EARLIER_MONTH), explained))
    assert closed['latest_closed'] == EARLIER_MONTH.isoformat() and closed['next_to_close'] == LAST_MONTH.isoformat()
    with pytest.raises(HTTPException, match='already closed'):
        call(live, 'owner', lambda s, a: close_month(s, a, key(EARLIER_MONTH), ALL_TICKED))
    call(live, 'owner', lambda s, a: close_month(s, a, key(LAST_MONTH), ALL_TICKED))
    with psycopg.connect(URL) as c:
        kept = c.execute('SELECT checklist FROM accounting.period_close WHERE business_id=%s AND month=%s', (live.business, EARLIER_MONTH)).fetchone()[0]
    assert kept['answers']['bank_cash'] == {'done': False, 'note': 'No bank account yet; cash counted'}
    assert {s['key'] for s in kept['steps']} >= {'trial_balance', 'transfers', 'gateway', 'review'}


def test_closing_is_refused_while_a_subledger_differs_from_its_account(live):
    started(live, LAST_MONTH)
    with psycopg.connect(URL) as c:  # stock on hand changed outside the books
        c.execute("SET session_replication_role = replica")
        c.execute("UPDATE catalog_items SET stock_quantity=stock_quantity+5 WHERE business_id=%s AND item_type='PRODUCT' AND track_stock", (live.business,))
    steps = {s['key']: s for s in call(live, 'owner', lambda s, a: overview(s))['checklist']}
    assert not steps['stock']['passed'] and 'differ from the ledger' in steps['stock']['detail']
    with pytest.raises(HTTPException, match='cannot close yet: Stock on hand at cost'):
        call(live, 'owner', lambda s, a: close_month(s, a, key(LAST_MONTH), ALL_TICKED))
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT count(*) FROM accounting.period_close WHERE business_id=%s', (live.business,)).fetchone()[0] == 0


def test_only_the_owner_reopens_the_latest_month_with_a_reason(live):
    started(live, EARLIER_MONTH)
    call(live, 'owner', lambda s, a: close_month(s, a, key(EARLIER_MONTH), ALL_TICKED))
    call(live, 'owner', lambda s, a: close_month(s, a, key(LAST_MONTH), ALL_TICKED))
    with pytest.raises(HTTPException, match='Only the business owner'):
        call(live, 'admin', lambda s, a: reopen_month(s, a, key(LAST_MONTH), ReopenMonth(reason='Missed a bill')))
    with pytest.raises(HTTPException, match='Reopen the later months first'):
        call(live, 'owner', lambda s, a: reopen_month(s, a, key(EARLIER_MONTH), ReopenMonth(reason='Missed a bill')))
    view = call(live, 'owner', lambda s, a: reopen_month(s, a, key(LAST_MONTH), ReopenMonth(reason='Supplier bill arrived late')))
    assert view['latest_closed'] == EARLIER_MONTH.isoformat() and view['next_to_close'] == LAST_MONTH.isoformat()
    assert [(h['event'], h['month'], h['reason']) for h in view['history']][:1] == [('period_reopened', LAST_MONTH.isoformat(), 'Supplier bill arrived late')]
    with pytest.raises(HTTPException, match='not closed'):
        call(live, 'owner', lambda s, a: reopen_month(s, a, key(LAST_MONTH), ReopenMonth(reason='Again please')))
    assert call(live, 'owner', lambda s, a: close_month(s, a, key(LAST_MONTH), ALL_TICKED))['latest_closed'] == LAST_MONTH.isoformat()


def test_a_closed_month_takes_no_posting_by_any_route(live, monkeypatch):
    with psycopg.connect(URL) as c:  # this month marked closed directly, to test the ledger's own refusal on today's date
        c.execute("""INSERT INTO accounting.period_close(business_id,month,status,closed_by,checklist) VALUES(%s,%s,'closed',%s,'{}')""",
                  (live.business, THIS_MONTH, live.people['owner']))
        lines = c.execute('SELECT count(*) FROM accounting.ledger WHERE business_id=%s', (live.business,)).fetchone()[0]
    with pytest.raises(Exception, match='ACCOUNTING_MONTH_CLOSED'):  # the ledger refuses the line itself
        call(live, 'owner', lambda s, a: expense_create(s, a, expense(live)))

    def test_engine(*args, **kwargs):
        engine = create_engine(URL.replace('postgresql://', 'postgresql+psycopg://'), poolclass=NullPool)

        @event.listens_for(engine, 'connect')
        def role(connection, record):
            connection.autocommit = True
            with connection.cursor() as cursor:
                cursor.execute('SET ROLE cacu_runtime')
            connection.autocommit = False
        return engine
    monkeypatch.setenv('CACU_DATABASE_URL', URL)
    monkeypatch.setattr(sessions, 'create_engine', test_engine)
    with pytest.raises(HTTPException) as refused:  # the API says it plainly
        with sessions.library_transaction(live.people['owner'], live.business, write=True) as session:
            expense_create(session, live.people['owner'], expense(live))
    assert refused.value.status_code == 409 and refused.value.detail.startswith('This month is closed')
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT count(*) FROM accounting.ledger WHERE business_id=%s', (live.business,)).fetchone()[0] == lines  # nothing posted
        c.execute("UPDATE accounting.period_close SET status='reopened',reopened_by=%s,reopened_at=now(),reopen_reason='Test reopened' WHERE business_id=%s",
                  (live.people['owner'], live.business))
    assert call(live, 'owner', lambda s, a: expense_create(s, a, expense(live)))  # open again: it posts
    assert month_end(LAST_MONTH) == THIS_MONTH - timedelta(days=1)
