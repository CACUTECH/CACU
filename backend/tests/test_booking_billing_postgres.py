"""Bookings, part 3 (Doc 10 services rules, Doc 09 PR-13 and PR-11): a completed booking is billed once, at the till or by
invoice, and a held deposit is applied so the customer pays only the rest. On a business started from the real chart."""
from decimal import Decimal
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.bookings import BookingInvoice, bill_info, bill_invoice, deposits_between
from cacu.accounting.checkout import receipt
from cacu.accounting.shifts import ShiftOpen, current, start
from cacu.accounting.transfers import TransferConfirm, confirm, list_transfers
from cacu.accounting.workflows import SaleCreate, sale_create
from test_corrections_postgres import live, call, balance, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_pos_checkout_postgres import as_template
from test_pos_refunds_postgres import as_member, books_balance
from test_bookings_postgres import salon, book, monday, at  # noqa: F401
from test_booking_deposits_postgres import rules, deposit
from test_activation_postgres import TODAY

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


def completed(live, booking):
    as_member(live, 'owner', "UPDATE appointments SET status='checked_in' WHERE id=%s RETURNING id", booking)
    as_member(live, 'owner', "UPDATE appointments SET status='completed' WHERE id=%s RETURNING id", booking)
    return booking


def paid(live, who, booking, method='Cash', key=None, **kw):
    data = SaleCreate(request_key=key or uuid4(), entry_date=TODAY, method=method, quoted_total='15000.00', booking_id=booking,
                      items=[{'item_id': live.salon['braids'], 'quantity': 1, 'discount_percent': '0'}], **kw)
    return call(live, who, lambda s, a: sale_create(s, a, data)), data


def test_paying_at_the_till_applies_the_deposit_so_the_customer_pays_the_rest(salon):
    live = salon
    rules(live)
    as_template(live, 'editor', 'cashier')
    booking = book(live, 'owner', at(10))[0]
    deposit(live, 'owner', booking)
    with pytest.raises(HTTPException, match='Complete the booking before billing it'):
        paid(live, 'editor', booking)
    completed(live, booking)
    assert call(live, 'editor', lambda s, a: bill_info(s, booking))['deposit'] == {'amount': '3000.00', 'method': 'cash', 'status': 'held'}
    call(live, 'editor', lambda s, a: start(s, a, ShiftOpen(request_key=uuid4(), opening_float='0')))
    with pytest.raises(HTTPException, match='less than the cash due'):
        paid(live, 'editor', booking, cash_received='11000')
    with pytest.raises(HTTPException, match='paid in cash or by transfer'):
        paid(live, 'editor', booking, method='Split', transfer_amount='5000')
    till, held = balance(live, '1000'), balance(live, '2100')
    sale, data = paid(live, 'editor', booking, cash_received='12000')
    assert (sale['deposit_applied'], sale['paid_now'], sale['change']) == ('3000.00', '12000.00', '0.00')
    assert call(live, 'editor', lambda s, a: sale_create(s, a, data)) == sale  # a retried checkout bills once
    assert balance(live, '1000') - till == Decimal('12000') and balance(live, '2100') - held == Decimal('3000')
    assert call(live, 'editor', lambda s, a: current(s, a))['shift']['expected_cash'] == '12000.00'
    slip = call(live, 'editor', lambda s, a: receipt(s, sale['saleId']))
    assert (slip['total'], slip['deposit_applied'], slip['paid_now']) == ('15000.00', '3000.00', '12000.00')
    assert [d['status'] for d in call(live, 'owner', lambda s, a: deposits_between(s, monday(), monday()))] == ['applied']
    info = call(live, 'owner', lambda s, a: bill_info(s, booking))
    assert (info['bill_kind'], info['bill_id'], info['deposit']) == ('sale', sale['saleId'], None)
    with pytest.raises(HTTPException, match='already been billed'):
        paid(live, 'editor', booking)
    with pytest.raises(psycopg.errors.CheckViolation, match='BOOKING_BILLED_ONCE'):
        as_member(live, 'owner', 'UPDATE appointments SET bill_kind=NULL,bill_id=NULL,billed_at=NULL WHERE id=%s RETURNING id', booking)
    books_balance(live)


def test_a_transfer_at_the_till_waits_for_only_the_rest(salon):
    live = salon
    rules(live)
    booking = book(live, 'owner', at(11))[0]
    deposit(live, 'owner', booking)
    completed(live, booking)
    clearing, bank = balance(live, '1020'), balance(live, '1010')
    sale, _ = paid(live, 'owner', booking, method='Transfer')
    assert sale['status'] == 'pending_payment' and sale['paid_now'] == '12000.00'
    assert balance(live, '1020') - clearing == Decimal('12000')
    waiting = [t for t in call(live, 'owner', lambda s, a: list_transfers(s)) if t['kind'] == 'sale']
    assert [t['amount'] for t in waiting] == ['12000.00']
    call(live, 'owner', lambda s, a: confirm(s, a, waiting[0]['id'], TransferConfirm(request_key=uuid4(), bank_account_id=live.ids['bank'])))
    assert balance(live, '1010') - bank == Decimal('12000') and balance(live, '1020') == clearing
    # Without a deposit, a booking is simply sold.
    plain = completed(live, book(live, 'owner', at(14))[0])
    assert paid(live, 'owner', plain)[0]['deposit_applied'] == '0.00'
    assert call(live, 'owner', lambda s, a: bill_info(s, plain))['bill_kind'] == 'sale'
    books_balance(live)


def test_an_invoice_for_the_booking_takes_the_deposit_off_what_is_owed(salon):
    live = salon
    rules(live)
    regular = book(live, 'owner', at(9), customer_name=None, customer_id=live.salon['customer'])[0]
    deposit(live, 'owner', regular)
    completed(live, regular)
    owed, held = balance(live, '1100'), balance(live, '2100')
    billed = call(live, 'owner', lambda s, a: bill_invoice(s, a, regular, BookingInvoice(request_key=uuid4())))
    assert (billed['total'], billed['deposit_applied'], billed['outstanding']) == ('15000.00', '3000.00', '12000.00')
    assert billed['invoice_number'].startswith('BK-')
    assert balance(live, '1100') - owed == Decimal('12000') and balance(live, '2100') - held == Decimal('3000')
    with pytest.raises(HTTPException, match='already been billed'):
        call(live, 'owner', lambda s, a: bill_invoice(s, a, regular, BookingInvoice(request_key=uuid4())))
    walk_in = completed(live, book(live, 'owner', at(11))[0])
    with pytest.raises(HTTPException, match='Choose the customer to invoice'):
        call(live, 'owner', lambda s, a: bill_invoice(s, a, walk_in, BookingInvoice(request_key=uuid4())))
    later = call(live, 'owner', lambda s, a: bill_invoice(s, a, walk_in, BookingInvoice(request_key=uuid4(), customer_id=live.salon['customer'])))
    assert (later['deposit_applied'], later['outstanding']) == ('0.00', '15000.00')
    books_balance(live)
