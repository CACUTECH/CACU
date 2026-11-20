"""Receivables (Doc 10 E11, Doc 09 ACC-006, PR-10, PR-11): one payment split across a customer's invoices, anything
beyond kept as their advance and later applied or handed back; transfers wait as one; ageing and customer statements."""
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.receivables import (AdvanceApply, AdvanceRefund, CustomerReceipt, ageing, apply_advance, open_items,
                                         receipt_create, refund_advance, statement)
from cacu.accounting.transfers import TransferConfirm, TransferNotReceived, confirm, list_transfers, not_received
from cacu.accounting.workflows import InvoiceCreate, ReceiptCreate, invoice_create, receipt_create as single_receipt
from test_corrections_postgres import live, call, balance, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_pos_refunds_postgres import books_balance
from test_activation_postgres import TODAY

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


def invoice(live, customer='ada', due=None):
    data = InvoiceCreate(request_key=uuid4(), customer_id=live.ids[customer], invoice_number=f'INV-{uuid4().hex[:6]}', entry_date=TODAY, due_date=due,
                         items=[{'catalog_item_id': live.items['Rice'], 'quantity': 1, 'unit_price': '65000'}])
    call(live, 'owner', lambda s, a: invoice_create(s, a, data))
    return str(data.request_key)


def paying(live, customer, amount, parts, method='Cash', **kw):
    return CustomerReceipt(request_key=uuid4(), customer_id=live.ids[customer], amount=amount, entry_date=TODAY, method=method,
                           allocations=[{'invoice_id': i, 'amount': a} for i, a in parts], **kw)


def status(invoice_id):
    with psycopg.connect(URL) as c:
        return c.execute('SELECT status FROM invoices WHERE id=%s', (invoice_id,)).fetchone()[0]


def test_one_payment_clears_several_invoices_oldest_first_and_keeps_the_rest_as_an_advance(live):
    first, second = invoice(live, due=TODAY + timedelta(days=7)), invoice(live, due=TODAY + timedelta(days=14))
    items = call(live, 'viewer', lambda s, a: open_items(s, live.ids['ada']))
    opening = items['invoices'][0]['id']  # the opening balance owed, due when the books started
    assert [i['id'] for i in items['invoices']] == [opening, first, second]
    assert (items['open_total'], items['advance']) == ('190000.00', '0.00')

    data = paying(live, 'ada', '200000', [(opening, '60000'), (first, '65000'), (second, '50000')])
    with pytest.raises(HTTPException, match='Customer deposits and advances'):
        call(live, 'editor', lambda s, a: receipt_create(s, a, data))  # only an Owner or Admin adds the account
    with pytest.raises(HTTPException, match='more than is still owed'):
        call(live, 'owner', lambda s, a: receipt_create(s, a, paying(live, 'ada', '70000', [(first, '70000')])))
    with pytest.raises(HTTPException, match='add up to more than the payment'):
        call(live, 'owner', lambda s, a: receipt_create(s, a, paying(live, 'ada', '1000', [(first, '2000')])))
    with pytest.raises(HTTPException, match='belong to this customer'):
        call(live, 'owner', lambda s, a: receipt_create(s, a, paying(live, 'bisi', '1000', [(first, '1000')])))

    till, owed = balance(live, '1000'), balance(live, '1100')
    paid = call(live, 'owner', lambda s, a: receipt_create(s, a, data))
    assert (paid['status'], paid['allocated'], paid['advance']) == ('posted', '175000.00', '25000.00')
    assert call(live, 'owner', lambda s, a: receipt_create(s, a, data)) == paid  # a retry records it once
    assert balance(live, '1000') - till == Decimal('200000') and owed - balance(live, '1100') == Decimal('175000')
    assert balance(live, '2100') == Decimal('-25000')
    assert [status(i) for i in (opening, first, second)] == ['paid', 'paid', 'sent']
    items = call(live, 'viewer', lambda s, a: open_items(s, live.ids['ada']))
    assert [(i['id'], i['open']) for i in items['invoices']] == [(second, '15000.00')] and items['advance'] == '25000.00'

    # PR-11: the advance pays the rest of the second invoice; it cannot pay more than it holds or than is owed.
    with pytest.raises(HTTPException, match='Only ₦15,000.00 is still owed'):
        call(live, 'editor', lambda s, a: apply_advance(s, a, second, AdvanceApply(request_key=uuid4(), amount='20000')))
    applied = call(live, 'editor', lambda s, a: apply_advance(s, a, second, AdvanceApply(request_key=uuid4(), amount='15000')))
    assert (applied['outstanding'], applied['advance']) == ('0.00', '10000.00') and status(second) == 'paid'
    third = invoice(live)
    with pytest.raises(HTTPException, match='holds ₦10,000.00 in advance'):
        call(live, 'editor', lambda s, a: apply_advance(s, a, third, AdvanceApply(request_key=uuid4(), amount='20000')))

    # Handing an advance back: Owners and Admins, from the till or a bank.
    refund = AdvanceRefund(request_key=uuid4(), amount='10000', method='Cash', note='Customer asked for it back')
    with pytest.raises(HTTPException, match='Only an Owner or Admin'):
        call(live, 'editor', lambda s, a: refund_advance(s, a, live.ids['ada'], refund))
    till = balance(live, '1000')
    assert call(live, 'admin', lambda s, a: refund_advance(s, a, live.ids['ada'], refund))['advance'] == '0.00'
    assert till - balance(live, '1000') == Decimal('10000') and balance(live, '2100') == Decimal('0')
    with psycopg.connect(URL) as c, pytest.raises(psycopg.errors.CheckViolation, match='ADVANCE_RECORD_IMMUTABLE'):
        c.execute('UPDATE accounting.customer_advance SET amount=1 WHERE business_id=%s', (live.business,))

    # The statement: invoices raise the balance; payments and the advance received lower it; applying the advance
    # does not move it again; handing it back raises it. What is left is the third invoice.
    account = call(live, 'viewer', lambda s, a: statement(s, live.ids['ada'], TODAY, TODAY))
    kinds = [line['kind'] for line in account['lines']]
    assert kinds.count('Invoice') == 4 and kinds.count('Payment') == 3 and 'Advance received' in kinds and 'Advance handed back' in kinds
    assert 'Deposit applied' not in kinds
    assert (account['opening'], account['closing'], account['advance_held']) == ('0.00', '65000.00', '0.00')
    books_balance(live)


def test_a_transfer_for_several_invoices_waits_as_one_and_posts_every_part_when_confirmed(live):
    first, second = invoice(live, 'bisi'), invoice(live, 'bisi')
    waiting = call(live, 'owner', lambda s, a: receipt_create(s, a, paying(live, 'bisi', '140000', [(first, '65000'), (second, '65000')], 'Transfer')))
    assert (waiting['status'], waiting['advance']) == ('awaiting_confirmation', '10000.00')
    # Its parts are waiting on each invoice, so the same money cannot be recorded twice.
    with pytest.raises(HTTPException, match='including transfers waiting'):
        call(live, 'owner', lambda s, a: single_receipt(s, a, ReceiptCreate(request_key=uuid4(), invoice_id=first, amount='1', entry_date=TODAY, method='Cash')))
    with pytest.raises(HTTPException, match='more than is still owed'):
        call(live, 'owner', lambda s, a: receipt_create(s, a, paying(live, 'bisi', '1', [(second, '1')])))
    items = call(live, 'viewer', lambda s, a: open_items(s, live.ids['bisi']))
    assert [(i['waiting'], i['open']) for i in items['invoices']] == [('65000.00', '0.00'), ('65000.00', '0.00')]
    listed = [t for t in call(live, 'owner', lambda s, a: list_transfers(s)) if t['id'] == waiting['id']]
    assert [(t['kind'], t['amount']) for t in listed] == [('customer payment', '140000.00')]
    assert [status(i) for i in (first, second)] == ['sent', 'sent']

    bank, owed = balance(live, '1010'), balance(live, '1100')
    call(live, 'owner', lambda s, a: confirm(s, a, waiting['id'], TransferConfirm(request_key=uuid4(), bank_account_id=live.ids['bank'])))
    assert balance(live, '1010') - bank == Decimal('140000') and owed - balance(live, '1100') == Decimal('130000')
    assert balance(live, '2100') == Decimal('-10000') and [status(i) for i in (first, second)] == ['paid', 'paid']
    assert call(live, 'viewer', lambda s, a: open_items(s, live.ids['bisi']))['advance'] == '10000.00'

    # Not received: nothing posts and the invoice stays owed.
    third = invoice(live, 'bisi')
    lost = call(live, 'editor', lambda s, a: receipt_create(s, a, paying(live, 'bisi', '65000', [(third, '65000')], 'Transfer')))
    call(live, 'owner', lambda s, a: not_received(s, a, lost['id'], TransferNotReceived(request_key=uuid4(), note='Never arrived')))
    assert [(i['id'], i['open']) for i in call(live, 'viewer', lambda s, a: open_items(s, live.ids['bisi']))['invoices']] == [(third, '65000.00')]
    books_balance(live)


def test_ageing_groups_what_is_owed_by_how_long_it_is_past_due(live):
    invoice(live, due=TODAY + timedelta(days=5))
    late = invoice(live, due=TODAY - timedelta(days=10))
    invoice(live, due=TODAY - timedelta(days=45))
    invoice(live, 'bisi', due=TODAY - timedelta(days=120))
    call(live, 'owner', lambda s, a: single_receipt(s, a, ReceiptCreate(request_key=uuid4(), invoice_id=late, amount='5000', entry_date=TODAY, method='Cash')))
    report = call(live, 'viewer', lambda s, a: ageing(s, 'receivables', TODAY))
    rows = {r['name']: r for r in report['rows']}
    ada = next(r for r in report['rows'] if r['party_id'] == str(live.ids['ada']))
    bisi = next(r for r in report['rows'] if r['party_id'] == str(live.ids['bisi']))
    # Ada: the opening balance (due today) and an invoice due in 5 days are not yet due; 60,000 is 10 days late.
    assert (ada['current'], ada['d1_30'], ada['d31_60'], ada['over_90'], ada['total']) == ('125000.00', '60000.00', '65000.00', '0.00', '250000.00')
    assert ada['documents'][0]['days_overdue'] == 45
    assert (bisi['over_90'], bisi['total']) == ('65000.00', '65000.00')
    assert report['totals']['total'] == format(sum(Decimal(r['total']) for r in rows.values()), '.2f')
    assert call(live, 'viewer', lambda s, a: ageing(s, 'receivables', TODAY - timedelta(days=1)))['rows'] == []  # nothing issued yet

    payables = call(live, 'viewer', lambda s, a: ageing(s, 'payables', TODAY))
    supplier = next(r for r in payables['rows'] if r['party_id'] == str(live.ids['supplier']))
    assert (supplier['current'], supplier['total'], supplier['documents'][0]['number']) == ('150000.50', '150000.50', 'Opening balance')
    with pytest.raises(HTTPException, match='receivables or payables'):
        call(live, 'viewer', lambda s, a: ageing(s, 'stock', TODAY))
