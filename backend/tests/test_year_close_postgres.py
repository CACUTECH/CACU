"""Year-end close (27 November 2026): the Owner closes a finished year once all its months are closed, in order; its
months are then locked until the year is reopened with a reason; the balance sheet shows closed years' profit as
retained earnings and the open year's as profit for the year. Nothing posts."""
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.periods import ReopenMonth, close_month, overview, reopen_month
from cacu.accounting.posting import PostingCommand, post_command
from cacu.accounting.reports import statements
from cacu.accounting.years import ReopenYear, close_year, reopen_year
from test_month_close_postgres import ALL_TICKED, EARLIER_MONTH, LAST_MONTH, key, started
from test_corrections_postgres import live, call, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_activation_postgres import TODAY

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
YEAR = LAST_MONTH.year  # with the year ending last month, the year is over


def year_ending_last_month(live):
    started(live, EARLIER_MONTH)
    with psycopg.connect(URL) as c:
        c.execute('INSERT INTO accounting.tax_profile(business_id, year_end_month, updated_by) VALUES (%s,%s,%s)',
                  (live.business, LAST_MONTH.month, live.people['owner']))


def sell(live, day, amount):
    call(live, 'owner', lambda s, a: post_command(s, a, PostingCommand(request_key=uuid4(), kind='adjustment', source_id=uuid4(),
        main_account_id=live.codes['1000'], entry_date=day, narration='Sales', credited=False,
        lines=[{'account_id': live.codes['4000'], 'amount': amount, 'credited': True}])))


def year(view, number):
    return next(y for y in view['years'] if y['year'] == number)


def equity_lines(live):
    report = call(live, 'viewer', lambda s, a: statements(s, TODAY.replace(day=1), TODAY))
    equity = next(s for s in report['financial_position']['sections'] if s['key'] == 'equity')
    return {l['name']: l['amounts'][0] for l in equity['lines']}, report


def test_a_finished_year_closes_once_its_months_are_closed_and_locks_them(live):
    year_ending_last_month(live)
    sell(live, LAST_MONTH, '50000.00')
    sell(live, TODAY, '7000.00')
    assert year(call(live, 'viewer', lambda s, a: overview(s)), YEAR)['months_open'] == [EARLIER_MONTH.isoformat(), LAST_MONTH.isoformat()]
    with pytest.raises(HTTPException, match='Close every month of the year first'):
        call(live, 'owner', lambda s, a: close_year(s, a, YEAR))
    call(live, 'owner', lambda s, a: close_month(s, a, key(EARLIER_MONTH), ALL_TICKED))
    call(live, 'owner', lambda s, a: close_month(s, a, key(LAST_MONTH), ALL_TICKED))
    with pytest.raises(HTTPException) as refused:
        call(live, 'admin', lambda s, a: close_year(s, a, YEAR))
    assert refused.value.status_code == 403
    with pytest.raises(HTTPException, match='once it has ended'):
        call(live, 'owner', lambda s, a: close_year(s, a, YEAR + 1))
    closed = call(live, 'owner', lambda s, a: close_year(s, a, YEAR))
    assert year({'years': closed}, YEAR)['status'] == 'closed'

    with pytest.raises(HTTPException, match='in a closed year'):
        call(live, 'owner', lambda s, a: reopen_month(s, a, key(LAST_MONTH), ReopenMonth(reason='Missed an invoice')))

    lines, report = equity_lines(live)
    assert 'Retained earnings from closed years' in lines and 'Profit to date not yet closed to retained earnings' not in lines
    assert lines['Retained earnings from closed years'] == year({'years': closed}, YEAR)['profit']  # the closed year's profit, ₦50,000 sale included
    assert float(lines['Profit for the year']) >= 7000.0  # this year's sale, not last year's
    assert report['financial_position']['difference'][0] == '0.00'  # nothing posted: the books still balance


def test_the_owner_reopens_the_latest_closed_year_with_a_reason(live):
    year_ending_last_month(live)
    call(live, 'owner', lambda s, a: close_month(s, a, key(EARLIER_MONTH), ALL_TICKED))
    call(live, 'owner', lambda s, a: close_month(s, a, key(LAST_MONTH), ALL_TICKED))
    call(live, 'owner', lambda s, a: close_year(s, a, YEAR))
    with pytest.raises(HTTPException) as refused:
        call(live, 'admin', lambda s, a: reopen_year(s, a, YEAR, ReopenYear(reason='Auditor adjustment')))
    assert refused.value.status_code == 403
    opened = call(live, 'owner', lambda s, a: reopen_year(s, a, YEAR, ReopenYear(reason='Auditor adjustment')))
    assert year({'years': opened}, YEAR)['status'] == 'open'
    call(live, 'owner', lambda s, a: reopen_month(s, a, key(LAST_MONTH), ReopenMonth(reason='Auditor adjustment')))  # months open again
    lines, _ = equity_lines(live)
    assert 'Profit to date not yet closed to retained earnings' in lines
    with psycopg.connect(URL) as c:  # the closing is kept, marked reopened
        assert c.execute('SELECT count(*), count(*) FILTER (WHERE reopened_at IS NOT NULL) FROM accounting.year_close WHERE business_id=%s',
                         (live.business,)).fetchone() == (1, 1)
