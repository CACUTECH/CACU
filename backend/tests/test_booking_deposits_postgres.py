"""Bookings, part 2 (Doc 10 services rules, Doc 09 PR-12): deposits held in Customer deposits and advances, taken in
cash (into the cashier's shift) or by transfer (waiting for confirmation), refunded inside the free-cancellation window,
and kept or refunded on a late cancellation or no-show by the owner's rule. On a business started from the real chart."""
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.bookings import BookingClose, BookingSettings, DepositTake, cancel, deposits_between, no_show, save_settings, settings, take
from cacu.accounting.transfers import TransferConfirm, TransferNotReceived, confirm, list_transfers, not_received
from cacu.accounting.shifts import ShiftOpen, current, start
from test_corrections_postgres import live, call, balance, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_pos_checkout_postgres import as_template
from test_pos_refunds_postgres import as_member, books_balance
from test_bookings_postgres import salon, book, monday, at  # noqa: F401
from test_activation_postgres import TODAY

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


def rules(live, hours=1, late='keep', who='owner', percent='20'):
    data = BookingSettings(free_cancel_hours=hours, late_deposit=late, rules=[{'service_id': live.salon['braids'], 'kind': 'percent', 'value': percent}])
    return call(live, who, lambda s, a: save_settings(s, a, data))


def deposit(live, who, booking, amount='3000', method='Cash', key=None, **kw):
    data = DepositTake(request_key=key or uuid4(), amount=amount, method=method, **kw)
    return call(live, who, lambda s, a: take(s, a, booking, data)), data


def close(live, who, booking, what=cancel, **kw):
    data = BookingClose(request_key=uuid4(), reason=kw.pop('reason', 'Customer travelled'), **kw)
    return call(live, who, lambda s, a: what(s, a, booking, data)), data


def deposits_code(live):
    with psycopg.connect(URL) as c:
        return c.execute("""SELECT a.code,a.name FROM accounting.account_map m JOIN accounts a ON a.id=m.account_id
                            WHERE m.business_id=%s AND m.purpose='customer_deposits'""", (live.business,)).fetchone()


def test_a_cash_deposit_is_held_in_customer_deposits_and_refunded_when_cancelled_in_time(salon):
    live = salon
    booking = book(live, 'owner', at(10))[0]
    with pytest.raises(HTTPException, match='Deposits are not set up yet'):
        deposit(live, 'owner', booking)
    as_template(live, 'editor', 'cashier')
    with pytest.raises(HTTPException, match='Only an Owner or Admin'):
        rules(live, who='editor')
    assert rules(live) == {'free_cancel_hours': 1, 'late_deposit': 'keep', 'deposits_ready': True,
                           'rules': [{'service_id': str(live.salon['braids']), 'kind': 'percent', 'value': '20.00'}]}
    assert deposits_code(live) == ('2100', 'Customer deposits and advances')
    assert rules(live, hours=2)['free_cancel_hours'] == 2 and deposits_code(live)[0] == '2100'  # added once
    call(live, 'editor', lambda s, a: start(s, a, ShiftOpen(request_key=uuid4(), opening_float='1000')))
    till, held = balance(live, '1000'), balance(live, '2100')
    taken, data = deposit(live, 'editor', booking)
    assert (taken['status'], taken['amount'], taken['method']) == ('held', '3000.00', 'cash')
    assert call(live, 'editor', lambda s, a: take(s, a, booking, data)) == taken  # a retry takes it once
    assert balance(live, '1000') - till == Decimal('3000') and balance(live, '2100') - held == Decimal('-3000')
    assert call(live, 'editor', lambda s, a: current(s, a))['shift']['expected_cash'] == '4000.00'
    with pytest.raises(HTTPException, match='already has a deposit'):
        deposit(live, 'editor', booking)
    with pytest.raises(HTTPException, match='more than the service price'):
        deposit(live, 'owner', book(live, 'owner', at(11))[0], amount='15000.01')
    with pytest.raises(psycopg.errors.CheckViolation, match='DEPOSIT_HELD'):
        as_member(live, 'owner', "UPDATE appointments SET status='cancelled',cancel_reason='x x x' WHERE id=%s RETURNING id", booking)
    done, _ = close(live, 'editor', booking)
    assert done == {'id': str(booking), 'status': 'cancelled', 'deposit': 'refund', 'deposit_amount': '3000.00'}
    assert balance(live, '1000') == till and balance(live, '2100') == held
    assert call(live, 'editor', lambda s, a: current(s, a))['shift']['expected_cash'] == '1000.00'
    assert [(d['status'], d['amount']) for d in call(live, 'owner', lambda s, a: deposits_between(s, monday(), monday()))] == [('refunded', '3000.00')]
    books_balance(live)


def test_late_cancellations_follow_the_owners_rule_and_a_transfer_deposit_waits_for_confirmation(salon):
    live = salon
    rules(live, hours=720)
    as_template(live, 'editor', 'service_staff')
    kept = book(live, 'owner', at(9))[0]
    deposit(live, 'owner', kept)
    with pytest.raises(HTTPException, match='go against the deposit rule'):
        close(live, 'editor', kept, deposit='refund')
    income, held = balance(live, '4100'), balance(live, '2100')
    assert close(live, 'editor', kept)[0]['deposit'] == 'keep'
    assert balance(live, '2100') - held == Decimal('3000') and balance(live, '4100') - income == Decimal('-3000')  # kept as service income

    sent = book(live, 'owner', at(14))[0]
    waiting, _ = deposit(live, 'owner', sent, method='Transfer')
    assert waiting['status'] == 'awaiting_transfer'
    assert [(t['kind'], t['amount']) for t in call(live, 'owner', lambda s, a: list_transfers(s))] == [('booking deposit', '3000.00')]
    with pytest.raises(HTTPException, match='still awaiting confirmation'):
        close(live, 'owner', sent)
    bank = balance(live, '1010')
    call(live, 'owner', lambda s, a: confirm(s, a, waiting['id'], TransferConfirm(request_key=uuid4(), bank_account_id=live.ids['bank'])))
    assert balance(live, '1010') - bank == Decimal('3000')
    refunded, _ = close(live, 'admin', sent, deposit='refund')  # late, but an approver may refund
    assert refunded['deposit'] == 'refund' and balance(live, '1010') == bank
    with pytest.raises(HTTPException, match='Only a confirmed booking'):
        close(live, 'admin', sent)
    books_balance(live)


def test_a_no_show_keeps_the_deposit_and_an_unpaid_transfer_takes_it_back(salon):
    live = salon
    rules(live)
    past = uuid4()
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL session_replication_role = replica')
        c.execute("""INSERT INTO appointments(id,business_id,staff_id,service_id,scheduled_at,ends_at,duration_minutes,title,status,customer_name)
                     VALUES(%s,%s,%s,%s,now()-interval '2 hours',now()-interval '75 minutes',45,'Braids','confirmed','Walk-in')""",
                  (past, live.business, live.salon['ada'], live.salon['braids']))
    deposit(live, 'owner', past)
    early = book(live, 'owner', at(10))[0]
    with pytest.raises(HTTPException, match='only after its start time'):
        close(live, 'owner', early, no_show)
    income = balance(live, '4100')
    assert close(live, 'owner', past, no_show, reason='')[0] == {'id': str(past), 'status': 'no_show', 'deposit': 'keep', 'deposit_amount': '3000.00'}
    assert income - balance(live, '4100') == Decimal('3000')
    with pytest.raises(HTTPException, match='This booking has no deposit'):
        close(live, 'owner', early, deposit='keep')

    clearing, held = balance(live, '1020'), balance(live, '2100')
    waiting, _ = deposit(live, 'owner', early, method='Transfer')
    call(live, 'owner', lambda s, a: not_received(s, a, waiting['id'], TransferNotReceived(request_key=uuid4(), note='Never arrived')))
    assert balance(live, '1020') == clearing and balance(live, '2100') == held
    assert [d['status'] for d in call(live, 'owner', lambda s, a: deposits_between(s, monday(), monday()))] == ['not_received']
    assert close(live, 'owner', early)[0]['deposit'] is None  # nothing left to settle
    assert call(live, 'viewer', lambda s, a: settings(s))['deposits_ready'] is True
    books_balance(live)
