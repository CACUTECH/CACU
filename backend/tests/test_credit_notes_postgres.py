"""Credit notes on invoices (Doc 10 E12, Doc 02 BP-06, Doc 09 PR-16): units given back or an amount taken off a line,
never more than the invoice charged; revenue taken back against the receivable up to what is still owed and the rest
kept as the customer's advance; goods back in stock at their cost; the owner's limit and separation of duties."""
from datetime import date
from decimal import Decimal
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.credit_notes import CreditDecision, CreditRequest, creditable, decide, list_credits, request
from cacu.accounting.receivables import AdvanceRefund, open_items, refund_advance, statement
from cacu.accounting.refunds import RefundPolicy, save_refund_policy
from cacu.accounting.workflows import InvoiceCreate, ReceiptCreate, invoice_create, receipt_create
from test_corrections_postgres import live, call, balance, stock, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_pos_refunds_postgres import books_balance
from test_activation_postgres import TODAY

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


def invoice(live, quantity=2, issue=True):
    data = InvoiceCreate(request_key=uuid4(), customer_id=live.ids['ada'], invoice_number=f'INV-{uuid4().hex[:6]}', entry_date=TODAY, issue=issue,
                         items=[{'catalog_item_id': live.items['Rice'], 'quantity': quantity, 'unit_price': '65000'}])
    call(live, 'owner', lambda s, a: invoice_create(s, a, data))
    return str(data.request_key)


def rice(live, invoice_id, who='owner'):
    return call(live, who, lambda s, a: creditable(s, invoice_id, a))['lines'][0]


def credit(live, who, invoice_id, quantity=0, amount=None, restock=True, key=None, reason='Two bags were spoilt'):
    data = CreditRequest(request_key=key or uuid4(), invoice_id=invoice_id, reason=reason,
                         lines=[{'line_id': rice(live, invoice_id)['line_id'], 'quantity': quantity, 'amount': amount, 'restock': restock}])
    return call(live, who, lambda s, a: request(s, a, data)), data


def invoice_row(invoice_id):
    with psycopg.connect(URL) as c:
        return c.execute('SELECT status,credited_total FROM invoices WHERE id=%s', (invoice_id,)).fetchone()


def test_the_owner_credits_returned_goods_and_a_price_allowance_on_an_unpaid_invoice(live):
    invoice_id = invoice(live)  # 2 bags of rice, 130,000
    start = {code: balance(live, code) for code in ('1100', '4000', '1200', '5000')}
    on_hand = stock(live, 'Rice')[0]
    first, data = credit(live, 'owner', invoice_id, quantity=1)
    assert (first['status'], first['number'], first['amount'], first['items']) == ('posted', 'CN-0001', '65000.00', '1 x Rice')
    assert (first['against_invoice'], first['to_advance']) == ('65000.00', '0.00')
    assert call(live, 'owner', lambda s, a: request(s, a, data)) == first  # a retried request credits once
    assert start['1100'] - balance(live, '1100') == Decimal('65000') and balance(live, '4000') - start['4000'] == Decimal('65000')
    assert stock(live, 'Rice')[0] == on_hand + 1 and first['posting']['stock_cost_restored'] == '50000.00'
    assert balance(live, '1200') - start['1200'] == Decimal('50000') and start['5000'] - balance(live, '5000') == Decimal('50000')
    assert invoice_row(invoice_id) == ('sent', Decimal('65000.00'))
    left = rice(live, invoice_id)
    assert (left['creditable_units'], left['creditable_amount'], left['restockable']) == (1, '65000.00', True)

    with pytest.raises(HTTPException, match='Only 1 x Rice'):
        credit(live, 'owner', invoice_id, quantity=2)
    with pytest.raises(HTTPException, match='not both'):
        credit(live, 'owner', invoice_id, quantity=1, amount='100')
    with pytest.raises(HTTPException, match='At most ₦65,000.00'):
        credit(live, 'owner', invoice_id, amount='70000')
    allowance, _ = credit(live, 'owner', invoice_id, amount='5000', reason='Bag was torn')
    assert (allowance['number'], allowance['items'], allowance['posting']['stock_cost_restored']) == ('CN-0002', 'Off Rice', '0.00')
    assert stock(live, 'Rice')[0] == on_hand + 1  # an allowance moves no stock
    left = rice(live, invoice_id)
    assert (left['creditable_units'], left['creditable_amount']) == (1, '60000.00')
    owed = [i['open'] for i in call(live, 'viewer', lambda s, a: open_items(s, live.ids['ada']))['invoices'] if i['id'] == invoice_id]
    assert owed == ['60000.00']
    # The last unit takes what is left on the line, so the line credits to exactly what it charged.
    last, _ = credit(live, 'owner', invoice_id, quantity=1, restock=False)
    assert last['amount'] == '60000.00' and invoice_row(invoice_id) == ('paid', Decimal('130000.00'))
    with pytest.raises(HTTPException, match='already been credited in full'):
        credit(live, 'owner', invoice_id, quantity=1)

    account = call(live, 'viewer', lambda s, a: statement(s, live.ids['ada'], TODAY, TODAY))
    notes = [(l['kind'], l['reference'].split(' ')[0], l['credit']) for l in account['lines'] if l['kind'] == 'Credit note']
    assert notes == [('Credit note', 'CN-0001', '65000.00'), ('Credit note', 'CN-0002', '5000.00'), ('Credit note', 'CN-0003', '60000.00')]
    assert [c['number'] for c in call(live, 'viewer', lambda s, a: list_credits(s, 'posted', a, invoice_id))['credit_notes']] == ['CN-0003', 'CN-0002', 'CN-0001']
    books_balance(live)


def test_a_credit_on_a_paid_invoice_is_kept_as_the_customers_advance(live):
    invoice_id = invoice(live, quantity=1)
    call(live, 'owner', lambda s, a: receipt_create(s, a, ReceiptCreate(request_key=uuid4(), invoice_id=invoice_id, amount='40000', entry_date=TODAY, method='Cash')))
    owed, held = balance(live, '1100'), balance(live, '2100')
    done, _ = credit(live, 'admin', invoice_id, quantity=1)
    assert (done['status'], done['against_invoice'], done['to_advance']) == ('posted', '25000.00', '40000.00')
    assert owed - balance(live, '1100') == Decimal('25000') and held - balance(live, '2100') == Decimal('40000')
    assert invoice_row(invoice_id) == ('paid', Decimal('65000.00'))
    assert call(live, 'viewer', lambda s, a: open_items(s, live.ids['ada']))['advance'] == '40000.00'
    account = call(live, 'viewer', lambda s, a: statement(s, live.ids['ada'], TODAY, TODAY))
    assert ('Credit kept as advance', done['number'], '40000.00') in [(l['kind'], l['reference'], l['credit']) for l in account['lines']]
    # The customer can have it back (E11).
    till = balance(live, '1000')
    back = AdvanceRefund(request_key=uuid4(), amount='40000', method='Cash', note='Returned the money for the spoilt bag')
    assert call(live, 'owner', lambda s, a: refund_advance(s, a, live.ids['ada'], back))['advance'] == '0.00'
    assert till - balance(live, '1000') == Decimal('40000')
    books_balance(live)


def test_who_may_credit_the_owners_limit_and_separation_of_duties(live):
    draft = invoice(live, issue=False)
    with pytest.raises(HTTPException, match='Only an issued invoice'):
        call(live, 'owner', lambda s, a: creditable(s, draft, a))
    invoice_id = invoice(live)
    line_id = rice(live, invoice_id)['line_id']
    with pytest.raises(HTTPException) as viewer:
        call(live, 'viewer', lambda s, a: request(s, a, CreditRequest(request_key=uuid4(), invoice_id=invoice_id, reason='No permission',
                                                                      lines=[{'line_id': line_id, 'quantity': 1}])))
    assert viewer.value.status_code == 403
    asked, _ = credit(live, 'editor', invoice_id, quantity=1)
    assert asked['status'] == 'pending' and asked['mine'] and invoice_row(invoice_id) == ('sent', Decimal('0.00'))
    assert rice(live, invoice_id)['creditable_units'] == 1  # a waiting credit note holds its units
    with pytest.raises(HTTPException) as editor:
        call(live, 'editor', lambda s, a: decide(s, a, asked['id'], True, CreditDecision()))
    assert editor.value.status_code == 403
    assert [c['id'] for c in call(live, 'admin', lambda s, a: list_credits(s, 'pending', a))['credit_notes']] == [asked['id']]
    approved = call(live, 'admin', lambda s, a: decide(s, a, asked['id'], True, CreditDecision(note='Seen the spoilt bag')))
    assert approved['status'] == 'posted' and approved['decision_note'] == 'Seen the spoilt bag'
    with pytest.raises(HTTPException, match='already posted'):
        call(live, 'admin', lambda s, a: decide(s, a, asked['id'], False, CreditDecision(note='Too late')))

    with pytest.raises(HTTPException) as admin:
        call(live, 'admin', lambda s, a: save_refund_policy(s, a, RefundPolicy(refund_threshold='10000')))
    assert admin.value.status_code == 403
    call(live, 'owner', lambda s, a: save_refund_policy(s, a, RefundPolicy(refund_threshold='10000')))
    small, _ = credit(live, 'admin', invoice_id, amount='5000')
    assert small['status'] == 'posted'  # within the limit
    above, _ = credit(live, 'admin', invoice_id, amount='20000')
    assert above['status'] == 'pending'
    with pytest.raises(HTTPException, match='Someone other than the requester'):
        call(live, 'admin', lambda s, a: decide(s, a, above['id'], True, CreditDecision()))
    with pytest.raises(HTTPException, match='Say why'):
        call(live, 'owner', lambda s, a: decide(s, a, above['id'], False, CreditDecision()))
    turned = call(live, 'owner', lambda s, a: decide(s, a, above['id'], False, CreditDecision(note='The bag was fine')))
    assert turned['status'] == 'rejected' and rice(live, invoice_id)['creditable_amount'] == '60000.00'  # the amount is free again
    withdrawn, _ = credit(live, 'editor', invoice_id, amount='1000')
    assert call(live, 'editor', lambda s, a: decide(s, a, withdrawn['id'], False, CreditDecision()))['decision_note'] == 'Withdrawn by the requester'

    with psycopg.connect(URL) as c, pytest.raises(psycopg.errors.CheckViolation, match='CREDIT_NOTE_RECORD_IMMUTABLE'):
        c.execute('UPDATE accounting.invoice_credit_line SET amount=1 WHERE business_id=%s', (live.business,))
    with psycopg.connect(URL) as c, pytest.raises(psycopg.errors.CheckViolation, match='CREDIT_NOTE_ALREADY_DECIDED'):
        c.execute("UPDATE accounting.invoice_credit SET status='rejected' WHERE business_id=%s AND id=%s", (live.business, approved['id']))
    books_balance(live)
