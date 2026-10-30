"""Turning on the books from an approved opening position (FR-130, RB-05, PR-01) on disposable PostgreSQL fixtures."""
from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.activation import ActivationError, activate, _main_and_rest
from cacu.accounting.posting import PostingCommand, post_command
from cacu.accounting.reports import financial_summary
from test_library_postgres import session_for
from test_management_postgres import managed, database, URL
from test_legacy_write_boundary_postgres import boundary, run
from test_default_chart_postgres import charted, adopt
from test_opening_position_postgres import books, answers, save, approve

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
TODAY = datetime.now(ZoneInfo('Africa/Lagos')).date()
STOCK = Decimal('503601.50')


def approved(books, **changes):
    _, legacy, _, _, people, ids = books
    version = save(legacy, people['owner'], answers(ids, **{'as_of': TODAY.isoformat(), **changes}))['position']['version']
    return approve(legacy, people['owner'], version, 'Matches bank statement')['position']


def turn_on(books, operator=None, reviewed=False):
    d, legacy, _, _, people, _ = books
    with d[0].begin() as c:
        return activate(c, legacy, operator or people['owner'], allow_unreviewed=not reviewed)


def nothing_created(books):
    d, legacy = books[0], books[1]
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT count(*) FROM accounting.business_map WHERE business_id=%s', (legacy,)).fetchone() == (0,)
        assert c.execute('SELECT count(*) FROM accounting.account_map WHERE business_id=%s', (legacy,)).fetchone() == (0,)
        assert c.execute('SELECT count(*) FROM accounting.entity').fetchone() == (1,)  # only the fixture's active business


def test_approved_journal_is_posted_exactly_and_the_books_go_live(books):
    d, legacy, _, _, people, ids = books
    position = approved(books)
    evidence = turn_on(books)
    assert evidence['start_date'] == TODAY.isoformat() and evidence['opening_version'] == position['version']
    assert evidence['debits'] == evidence['credits'] == format(Decimal(position['summary']['owns']), '.2f')
    assert evidence['template_reviewed'] is False and evidence['legacy_after_start_date'] == {}
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT state,cutover_date,timezone FROM accounting.business_map WHERE business_id=%s', (legacy,)).fetchone() == \
            ('active', TODAY, 'Africa/Lagos')
        posted = dict(c.execute("""SELECT m.account_id::text, sum(CASE WHEN l.entry_type::text='DEBIT' THEN l.amount ELSE -l.amount END)
            FROM accounting.ledger l JOIN accounting.account_map m ON m.library_id=l.post_account_id AND m.business_id=l.business_id
            WHERE l.business_id=%s GROUP BY 1""", (legacy,)).fetchall())
        expected = {}
        for line in position['journal']['lines']:
            expected[line['account_id']] = expected.get(line['account_id'], 0) + Decimal(line['amount']) * (1 if line['side'] == 'debit' else -1)
        assert posted == expected
        assert c.execute("SELECT count(*) FROM accounting.document_map WHERE business_id=%s AND source_type='opening_balance'", (legacy,)).fetchone() == (1,)
        assert c.execute("SELECT count(*) FROM audit_logs WHERE business_id=%s AND action='BOOKS_ACTIVATED'", (legacy,)).fetchone() == (1,)
        narrations = {r[0] for r in c.execute('SELECT narration FROM accounting.line_item WHERE business_id=%s', (legacy,))}
        assert 'Opening balance: Ada Stores' in narrations and 'Opening balance: Mills Ltd' in narrations
        entity = c.execute('SELECT entity_id FROM accounting.business_map WHERE business_id=%s', (legacy,)).fetchone()[0]

    # The restricted runtime now reads balanced books with the opening balances in place.
    runtime = (d[0], legacy, people['owner'], entity, None, None, TODAY.year)
    with d[0].begin() as c:
        s = session_for(c, runtime)
        summary = financial_summary(s, TODAY, TODAY)
        s.close()
    assert summary['trial_balance_difference'] == summary['balance_sheet_difference'] == '0.00'
    assert (summary['cash'], summary['inventory'], summary['receivables']) == ('425000.00', format(STOCK, '.2f'), '60000.00')
    assert summary['liabilities']['total'] == '350000.50' and summary['net_profit'] == '0.00'

    # Opening answers are frozen once the books are live, and the browser can see that.
    read = run(people['owner'], 'SELECT public.opening_position(%s)', (legacy,))[0][0]
    assert read['books_active'] is True
    with pytest.raises(psycopg.Error, match='BOOKS_ALREADY_SET_UP'):
        save(legacy, people['owner'], answers(ids), version=position['version'])
    with pytest.raises(ActivationError, match='BOOKS_ALREADY_SET_UP'):
        turn_on(books)


def test_runtime_refuses_postings_before_the_start_date(books):
    d, legacy, _, _, people, _ = books
    approved(books)
    turn_on(books)
    with psycopg.connect(URL) as c:
        entity = c.execute('SELECT entity_id FROM accounting.business_map WHERE business_id=%s', (legacy,)).fetchone()[0]
        cash, capital = (c.execute("SELECT id FROM accounts WHERE business_id=%s AND code=%s", (legacy, code)).fetchone()[0] for code in ('1000', '3000'))
    if TODAY.timetuple().tm_yday == 1:
        pytest.skip('No earlier date in this reporting year')
    command = PostingCommand(request_key=uuid4(), kind='adjustment', source_id=uuid4(), main_account_id=capital,
                             entry_date=TODAY - timedelta(days=1), narration='Backdated', lines=[{'account_id': cash, 'amount': '10'}])
    with d[0].begin() as c:
        s = session_for(c, (d[0], legacy, people['owner'], entity, None, None, TODAY.year))
        with pytest.raises(HTTPException, match='predates'):
            post_command(s, people['owner'], command)
        s.close()


def test_needs_an_approved_position_and_a_reviewed_chart(books):
    d, legacy, _, _, people, ids = books
    save(legacy, people['owner'], answers(ids, as_of=TODAY.isoformat()))
    with pytest.raises(ActivationError, match='OPENING_POSITION_NOT_APPROVED'):
        turn_on(books)
    approve(legacy, people['owner'], 1)
    with pytest.raises(ActivationError, match='CHART_NOT_READY: .*awaiting accountant review'):
        turn_on(books, reviewed=True)
    nothing_created(books)


@pytest.mark.parametrize('role', ['editor', 'viewer', 'outsider'])
def test_only_an_owner_or_admin_can_ask_for_activation(books, role):
    approved(books)
    with pytest.raises(ActivationError, match='OPERATOR_NOT_AUTHORISED'):
        turn_on(books, operator=books[4][role])
    nothing_created(books)


def test_stock_changes_after_approval_need_a_fresh_review(books):
    _, legacy = books[0], books[1]
    approved(books)
    with psycopg.connect(URL) as c:
        c.execute('ALTER TABLE public.catalog_items DISABLE TRIGGER USER')
        c.execute("UPDATE catalog_items SET stock_quantity=stock_quantity+1 WHERE business_id=%s AND name='Rice'", (legacy,))
        c.execute('ALTER TABLE public.catalog_items ENABLE TRIGGER USER')
    with pytest.raises(ActivationError, match='STOCK_CHANGED'):
        turn_on(books)
    nothing_created(books)


def test_a_removed_customer_needs_a_fresh_review(books):
    _, legacy, _, _, _, ids = books
    approved(books)
    with psycopg.connect(URL) as c:
        c.execute('DELETE FROM customers WHERE id=%s', (ids['ada'],))
    with pytest.raises(ActivationError, match='PARTY_REMOVED'):
        turn_on(books)
    nothing_created(books)


def test_old_style_records_after_the_start_date_are_not_left_out(books):
    _, legacy, _, _, people, _ = books
    if TODAY.timetuple().tm_yday == 1:
        pytest.skip('No earlier date in this reporting year')
    approved(books, as_of=(TODAY - timedelta(days=1)).isoformat())
    with psycopg.connect(URL) as c:
        c.execute("INSERT INTO financial_transactions(business_id,description,amount,type,category,date,created_by) VALUES(%s,'Sale',500,'Income','Sales',%s,%s)",
                  (legacy, TODAY, people['owner']))
    with pytest.raises(ActivationError, match="LEGACY_ACTIVITY_AFTER_START_DATE: {'financial_transactions': 1}"):
        turn_on(books)
    nothing_created(books)


def test_start_date_must_be_in_the_current_reporting_year(books):
    approved(books)
    d, legacy, _, _, people, _ = books
    with pytest.raises(ActivationError, match='START_DATE_OUTSIDE_CURRENT_YEAR'):
        with d[0].begin() as c:
            activate(c, legacy, people['owner'], allow_unreviewed=True, today=TODAY.replace(year=TODAY.year + 1))
    nothing_created(books)


def test_main_line_avoids_repeated_accounts():
    lines = [{'account_id': 'ar', 'side': 'debit', 'amount': '5'}, {'account_id': 'ar', 'side': 'debit', 'amount': '7'},
             {'account_id': 'cash', 'side': 'debit', 'amount': '1'}, {'account_id': 'ap', 'side': 'credit', 'amount': '13'}]
    main, rest = _main_and_rest(lines)
    assert main == 'cash' and [l['account_id'] for l in rest] == ['ar', 'ar', 'ap']
    repeated = [{'account_id': a, 'side': s, 'amount': '1'} for a, s in [('ar', 'debit'), ('ar', 'debit'), ('ap', 'credit'), ('ap', 'credit')]]
    main, rest = _main_and_rest(repeated)
    assert main == 'ar' and [l['account_id'] for l in rest] == ['ap', 'ap']


def test_dry_run_proves_every_check_then_leaves_nothing_behind(books):
    d, legacy, _, _, people, _ = books
    approved(books)
    with d[0].connect() as c:
        transaction = c.begin()
        evidence = activate(c, legacy, people['owner'], allow_unreviewed=True)
        transaction.rollback()
    assert evidence['transaction_id'] and evidence['accounts'] == 28 and evidence['parties'] == 3
    nothing_created(books)
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT count(*) FROM accounting.ledger WHERE business_id=%s', (legacy,)).fetchone() == (0,)
    assert turn_on(books)['opening_version'] == 1  # the real run still works afterwards
