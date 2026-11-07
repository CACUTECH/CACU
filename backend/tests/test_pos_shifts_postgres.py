"""POS, part 4 (Doc 10 shifts, PR-22): a cashier's float, the sales and cash movements tagged to their shift, the count at
close with any difference posted to Cash over and short, the owner's view, and the plan gate.
On a business started from the real chart, as in the release-gate tests."""
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.workflows import sale_create
from cacu.accounting.transfers import TransferNotReceived, daily, not_received
from cacu.accounting.checkout import options
from cacu.accounting.refunds import RefundDecision, decide
from cacu.accounting.shifts import (CashMovement, ShiftClose, ShiftOpen, ShiftPolicy, close, current, list_shifts, move,
                                    save_shift_policy, start)
from test_corrections_postgres import live, call, balance, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_pos_checkout_postgres import sale, as_template
from test_pos_refunds_postgres import refund, books_balance, sold
from test_activation_postgres import TODAY

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


def opened(live, who, amount='5000'):
    data = ShiftOpen(request_key=uuid4(), opening_float=amount)
    return call(live, who, lambda s, a: start(s, a, data)), data


def movement(live, who, shift_id, kind, amount, **kw):
    data = CashMovement(request_key=uuid4(), kind=kind, amount=amount, reason='Diesel for the generator', **kw)
    return call(live, who, lambda s, a: move(s, a, shift_id, data))


def closing(live, who, shift_id, counted, note=''):
    data = ShiftClose(request_key=uuid4(), counted_cash=counted, note=note)
    return call(live, who, lambda s, a: close(s, a, shift_id, data))


def on_plan(live, plan):
    with psycopg.connect(URL) as c:
        c.execute("SELECT set_config('platform.reason','Test plan',true)")
        c.execute("""INSERT INTO platform.subscriptions(business_id,plan_code,status) VALUES(%s,%s,'active')
                     ON CONFLICT (business_id) DO UPDATE SET plan_code=EXCLUDED.plan_code""", (live.business, plan))


def test_a_cashiers_shift_tracks_the_till_and_a_shortage_posts_to_cash_over_and_short(live):
    as_template(live, 'editor', 'cashier')
    assert call(live, 'editor', lambda s, a: current(s, a)) == {'available': True, 'require_shift': False, 'shift': None, 'can_manage': False,
                                                                 'pay_out_accounts': [], 'outlets': [], 'own_outlet': None}
    shift, data = opened(live, 'editor')
    choices = [a['code'] for a in call(live, 'editor', lambda s, a: current(s, a))['pay_out_accounts']]
    assert '6300' in choices and '6900' not in choices
    assert call(live, 'editor', lambda s, a: start(s, a, data)) == shift  # a retried open opens once
    with pytest.raises(HTTPException, match='already have a shift open'):
        opened(live, 'editor')
    sold(live, 'editor', lines=(('Beans', 2, '0'),), cash_received='5000')               # 3,000 cash
    sold(live, 'editor', method='Split', lines=(('Beans', 1, '0'),), transfer_amount='500')  # 1,000 cash
    sold(live, 'editor', method='Transfer', lines=(('Rice', 1, '0'),))                    # no cash
    sold(live, 'owner', lines=(('Rice', 1, '0'),))                                        # the owner's sale is not on this shift
    start_cash, start_fuel, start_bank = balance(live, '1000'), balance(live, '6300'), balance(live, '1010')
    movement(live, 'editor', shift['id'], 'pay_out', '700', expense_account_id=live.codes['6300'])
    movement(live, 'editor', shift['id'], 'pay_in', '2000', bank_account_id=live.ids['bank'])
    now = movement(live, 'editor', shift['id'], 'pay_out', '1000', bank_account_id=live.ids['bank'])
    assert balance(live, '6300') - start_fuel == Decimal('700') and balance(live, '1010') - start_bank == Decimal('-1000')
    assert balance(live, '1000') - start_cash == Decimal('300')
    assert {k: now[k] for k in ('sales', 'opening_float', 'cash_sales', 'pay_ins', 'pay_outs', 'expected_cash')} == {
        'sales': 3, 'opening_float': '5000.00', 'cash_sales': '4000.00', 'pay_ins': '2000.00', 'pay_outs': '1700.00', 'expected_cash': '9300.00'}
    assert [(m['kind'], m['destination'], m['amount']) for m in now['movements']] == [
        ('pay_out', 'expense', '700.00'), ('pay_in', 'bank', '2000.00'), ('pay_out', 'bank', '1000.00')]
    with pytest.raises(HTTPException, match='only hold ₦9,300.00'):
        movement(live, 'editor', shift['id'], 'pay_out', '9300.01', expense_account_id=live.codes['6300'])
    with pytest.raises(HTTPException, match='Only the cashier on this shift'):
        movement(live, 'admin', shift['id'], 'pay_out', '100', expense_account_id=live.codes['6300'])
    with pytest.raises(HTTPException, match='Choose an expense account'):
        movement(live, 'editor', shift['id'], 'pay_out', '100', expense_account_id=live.codes['6900'])
    with pytest.raises(HTTPException, match='Say what happened'):
        closing(live, 'editor', shift['id'], '9000')
    with pytest.raises(HTTPException, match='Only the cashier, or someone who can approve'):
        closing(live, 'viewer', shift['id'], '9300')
    start_cash, start_short = balance(live, '1000'), balance(live, '6900')
    done = closing(live, 'editor', shift['id'], '9000', 'Gave too much change')
    assert (done['status'], done['expected_cash'], done['counted_cash'], done['variance']) == ('closed', '9300.00', '9000.00', '-300.00')
    assert balance(live, '6900') - start_short == Decimal('300') and balance(live, '1000') - start_cash == Decimal('-300')
    with pytest.raises(HTTPException, match='already closed'):
        closing(live, 'editor', shift['id'], '9000', 'Again')
    sold(live, 'editor', lines=(('Rice', 1, '0'),))  # after closing, sales no longer join the shift
    assert call(live, 'owner', lambda s, a: list_shifts(s, a, TODAY))[0]['sales'] == 3
    report = call(live, 'owner', lambda s, a: daily(s, TODAY, a))['shifts']
    assert [s['variance'] for s in report['closed']] == ['-300.00'] and report['variance_total'] == '-300.00' and report['open'] == []
    books_balance(live)


def test_refunds_and_reversals_come_out_of_the_till_and_a_manager_closes_a_forgotten_shift(live):
    as_template(live, 'editor', 'cashier')
    shift, _ = opened(live, 'editor', '1000')
    sale_id = sold(live, 'editor', lines=(('Beans', 2, '0'),))                                 # 3,000 cash
    split = sold(live, 'editor', method='Split', lines=(('Beans', 1, '0'),), transfer_amount='500')  # 1,000 cash
    asked, _ = refund(live, 'editor', sale_id, 1)
    assert asked['status'] == 'pending'
    paid = call(live, 'admin', lambda s, a: decide(s, a, asked['id'], True, RefundDecision()))
    assert paid['posting']['shift_id'] == shift['id']  # paid back from the cashier's till, though the admin approved it
    opened(live, 'admin', '0')
    call(live, 'admin', lambda s, a: not_received(s, a, split, TransferNotReceived(request_key=uuid4(), note='Transfer bounced')))
    admin_shift = call(live, 'admin', lambda s, a: current(s, a))['shift']
    assert admin_shift['cash_handed_back'] == '1000.00' and admin_shift['expected_cash'] == '-1000.00'
    mine = call(live, 'editor', lambda s, a: current(s, a))['shift']
    assert (mine['cash_refunds'], mine['expected_cash']) == ('1500.00', '3500.00')
    assert [s['id'] for s in call(live, 'editor', lambda s, a: list_shifts(s, a, TODAY))] == [shift['id']]  # a cashier sees their own
    assert len(call(live, 'owner', lambda s, a: list_shifts(s, a, TODAY, 'open'))) == 2
    start_cash, start_short = balance(live, '1000'), balance(live, '6900')
    done = closing(live, 'admin', shift['id'], '3600', 'Counted with the cashier')  # 100 over
    assert done['variance'] == '100.00' and done['opened_by_name'] and not done['mine']
    assert balance(live, '6900') - start_short == Decimal('-100') and balance(live, '1000') - start_cash == Decimal('100')
    books_balance(live)


def test_a_shift_open_past_midnight_is_flagged_and_the_owner_can_require_shifts(live):
    as_template(live, 'editor', 'cashier')
    yesterday = uuid4()
    with psycopg.connect(URL) as c:
        c.execute('INSERT INTO accounting.till_shift(business_id,id,opened_by,opened_on,opening_float) VALUES(%s,%s,%s,%s,0)',
                  (live.business, yesterday, live.people['editor'], TODAY - timedelta(days=1)))
    report = call(live, 'owner', lambda s, a: daily(s, TODAY, a))['shifts']
    assert [(s['id'], s['overdue']) for s in report['open']] == [(str(yesterday), True)]
    closing(live, 'editor', yesterday, '0')  # no difference, so no note is needed and nothing posts
    with pytest.raises(HTTPException, match='Only the business owner'):
        call(live, 'admin', lambda s, a: save_shift_policy(s, a, ShiftPolicy(require_shift=True)))
    assert call(live, 'owner', lambda s, a: save_shift_policy(s, a, ShiftPolicy(require_shift=True))) == {'require_shift': True}
    assert call(live, 'editor', lambda s, a: options(s))['require_shift'] is True
    with pytest.raises(HTTPException, match='Open your shift before selling'):
        sold(live, 'editor')
    opened(live, 'editor')
    sold(live, 'editor')


def test_shifts_come_with_the_oga_and_chairman_plans(live):
    on_plan(live, 'BASE')
    assert call(live, 'owner', lambda s, a: current(s, a))['available'] is False
    with pytest.raises(HTTPException, match='Oga and Chairman plans'):
        opened(live, 'owner')
    assert call(live, 'owner', lambda s, a: list_shifts(s, a, TODAY)) == []
    assert call(live, 'owner', lambda s, a: daily(s, TODAY, a))['shifts'] is None
    on_plan(live, 'GROW')
    assert opened(live, 'owner')[0]['status'] == 'open'
