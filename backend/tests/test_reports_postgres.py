"""Trial balance (FR-143, ACC-013), general ledger (FR-140) and the first-period cash flow on a business turned on
from an approved opening position."""
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4
import pytest
from fastapi import HTTPException
from cacu.accounting.posting import PostingCommand, post_command
from cacu.accounting.stock import request_adjustment
from cacu.accounting.workflows import expense_create
import cacu.accounting.reports as reports
from cacu.accounting.reports import cash_flow, general_ledger, trial_balance
from test_corrections_postgres import live, call, expense, adjustment, URL
from test_opening_position_postgres import books
from test_default_chart_postgres import charted
from test_legacy_write_boundary_postgres import boundary
from test_management_postgres import managed, database
from test_activation_postgres import TODAY

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


def test_first_period_cash_flow_starts_from_the_opening_cash(live):
    report = call(live, 'viewer', lambda s, a: cash_flow(s, TODAY, TODAY))
    assert (report['opening_cash'], report['closing_cash'], report['ledger_cash'], report['net_change']) == ('425000.00', '425000.00', '425000.00', '0.00')
    assert report['reconciled'] and report['empty'] and all(not s['lines'] for s in report['sections'])
    call(live, 'owner', lambda s, a: expense_create(s, a, expense(live)))
    report = call(live, 'viewer', lambda s, a: cash_flow(s, TODAY, TODAY))
    operating = next(s for s in report['sections'] if s['key'] == 'operating')
    assert operating['total'] == '-15000.00' and [l['label'] for l in operating['lines']] == ['Net profit']
    assert (report['opening_cash'], report['closing_cash']) == ('425000.00', '410000.00') and report['reconciled'] and not report['empty']


def test_trial_balance_balances_and_its_control_checks_pass(live):
    call(live, 'owner', lambda s, a: expense_create(s, a, expense(live)))
    call(live, 'owner', lambda s, a: request_adjustment(s, a, adjustment(live, -2)))
    report = call(live, 'viewer', lambda s, a: trial_balance(s, TODAY))
    assert report['tier'] == 'Management statements, not reviewed' and report['basis'] == 'Accrual' and report['currency'] == 'NGN'
    assert report['controls_checked'] and report['exceptions'] == [] and report['difference'] == '0.00'
    assert report['total_debit'] == report['total_credit']
    by_code = {l['code']: (l['debit'], l['credit']) for l in report['lines']}
    assert by_code['1000'] == ('10000.00', '0.00') and by_code['1100'] == ('60000.00', '0.00')
    assert by_code['1200'] == ('403601.50', '0.00') and by_code['2000'] == ('0.00', '150000.50')
    assert by_code['5100'] == ('100000.00', '0.00') and '3900' not in by_code  # zero balances are left out
    assert [l['code'] for l in report['lines']] == sorted(by_code)


def test_trial_balance_lists_a_control_account_that_disagrees_with_its_documents(live):
    key = uuid4()
    journal = PostingCommand(request_key=key, kind='adjustment', source_id=key, main_account_id=live.codes['1100'], entry_date=TODAY,
                             narration='Owed by Ada, no invoice', credited=False, lines=[{'account_id': live.codes['4900'], 'amount': '5000', 'credited': True}])
    call(live, 'owner', lambda s, a: post_command(s, a, journal))
    report = call(live, 'viewer', lambda s, a: trial_balance(s, TODAY))
    assert report['difference'] == '0.00'
    assert [(e['check'], e['difference']) for e in report['exceptions']] == [('receivables', '5000.00')]
    assert 'Customer balances on open invoices (60000.00) differ from the ledger (65000.00)' == report['exceptions'][0]['message']


def test_trial_balance_before_the_books_started_is_empty_and_skips_today_only_checks(live):
    report = call(live, 'viewer', lambda s, a: trial_balance(s, TODAY - timedelta(days=1)))
    assert report['lines'] == [] and not report['controls_checked'] and report['exceptions'] == []


def test_general_ledger_shows_running_balances_across_pages(live, monkeypatch):
    for amount in ('1000', '2000'):
        call(live, 'owner', lambda s, a: expense_create(s, a, expense(live, amount=amount)))
    report = call(live, 'viewer', lambda s, a: general_ledger(s, live.codes['1000'], TODAY, TODAY))
    assert (report['opening_balance'], report['total_debit'], report['total_credit'], report['closing_balance']) == ('0.00', '25000.00', '3000.00', '22000.00')
    assert [(e['debit'], e['credit'], e['balance']) for e in report['entries']] == [('25000.00', '0.00', '25000.00'), ('0.00', '1000.00', '24000.00'), ('0.00', '2000.00', '22000.00')]
    assert report['entries'][1]['counter_account'] == '6200 Utilities and power (including diesel)' and report['entries'][1]['description'] == 'Diesel for the generator'
    monkeypatch.setattr(reports, 'PAGE', 2)
    second = call(live, 'viewer', lambda s, a: general_ledger(s, live.codes['1000'], TODAY, TODAY, page=1))
    assert second['total_entries'] == 3 and [e['balance'] for e in second['entries']] == ['22000.00']
    later = call(live, 'viewer', lambda s, a: general_ledger(s, live.codes['1000'], TODAY + timedelta(days=1), TODAY + timedelta(days=2)))
    assert (later['opening_balance'], later['closing_balance'], later['entries']) == ('22000.00', '22000.00', [])


def test_general_ledger_refuses_accounts_of_other_businesses(live):
    with pytest.raises(HTTPException, match='Account not found'):
        call(live, 'viewer', lambda s, a: general_ledger(s, uuid4(), TODAY, TODAY))
