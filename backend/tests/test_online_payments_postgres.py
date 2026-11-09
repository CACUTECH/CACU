"""Online invoice payments through the business's own Paystack account (Doc 10 E23; Doc 09 PR-14, PR-15; Doc 11;
Doc 14 TEST-201 to TEST-204 applied to tenant payments). Paystack is replaced by a recorded fake; everything else is
the real database and the real posting engine."""
import base64
import hashlib
import hmac
import json
import os
from contextlib import contextmanager
from decimal import Decimal
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting import online_payments as op
from cacu.accounting.workflows import InvoiceCreate, ReceiptCreate, invoice_create, receipt_create
from cacu.payments import keys, service
from test_corrections_postgres import live, call, balance, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_library_postgres import session_for
from test_pos_refunds_postgres import books_balance
from test_activation_postgres import TODAY

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
SECRET = 'sk_test_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4'


class FakePaystack:
    """Answers the way Paystack's API does, from what the test sets."""
    instances = []

    def __init__(self, secret):
        assert secret == SECRET  # the business's own key, opened from the database
        self.secret, self.mode = secret, 'test'
        FakePaystack.instances.append(self)

    verified = {}
    started = []
    payouts = []
    payout_items = {}

    def signature_valid(self, raw, signature):
        return bool(signature) and hmac.compare_digest(hmac.new(self.secret.encode(), raw, hashlib.sha512).hexdigest(), signature)

    def initialize(self, **kw):
        FakePaystack.started.append(kw)
        return 'https://checkout.paystack.com/' + kw['reference'][-8:]

    def verify(self, reference):
        return FakePaystack.verified.get(reference, {'status': 'not_found'})

    def settlements(self, start, end):
        return FakePaystack.payouts

    def settlement_transactions(self, settlement_id):
        return FakePaystack.payout_items.get(settlement_id, [])


@pytest.fixture
def paystack(live, monkeypatch):
    monkeypatch.setenv('CACU_PAYMENT_KEY_ENCRYPTION_KEY', base64.b64encode(os.urandom(32)).decode())
    monkeypatch.setattr(service, 'Paystack', FakePaystack)
    FakePaystack.verified, FakePaystack.started, FakePaystack.payouts, FakePaystack.payout_items = {}, [], [], {}

    @contextmanager
    def tenant(actor, business, write=False, while_read_only=False, permission=None):
        with live.engine.begin() as c:
            s = session_for(c, (live.engine, business, actor, live.entity, None, None, TODAY.year))
            try:
                yield s
                s.flush()
            finally:
                s.close()

    @contextmanager
    def platform():
        with psycopg.connect(URL) as connection, connection.transaction(), connection.cursor() as cursor:
            cursor.execute('SET LOCAL ROLE cacu_runtime')
            yield cursor

    monkeypatch.setattr(service, 'library_transaction', tenant)
    monkeypatch.setattr(service, 'platform_transaction', platform)
    return FakePaystack


def invoice(live, amount='65000'):
    data = InvoiceCreate(request_key=uuid4(), customer_id=live.ids['ada'], invoice_number=f'INV-{uuid4().hex[:6]}', entry_date=TODAY,
                         items=[{'catalog_item_id': live.items['Rice'], 'quantity': 1, 'unit_price': amount}])
    call(live, 'owner', lambda s, a: invoice_create(s, a, data))
    return str(data.request_key)


def connect(live, who='owner'):
    data = op.PaystackConnect(request_key=uuid4(), secret_key=SECRET, settlement_bank_account_id=live.ids['bank'])
    return call(live, who, lambda s, a: op.connect(s, a, data, 'test'))


def success(reference, naira, fee):
    return {'status': 'success', 'reference': reference, 'currency': 'NGN', 'amount': int(Decimal(naira) * 100), 'fees': int(Decimal(fee) * 100),
            'paid_at': f'{TODAY.isoformat()}T10:15:00.000Z', 'channel': 'card'}


def event(reference, event_id):
    return json.dumps({'event': 'charge.success', 'data': {'id': event_id, 'reference': reference, 'status': 'success', 'amount': 1}}).encode()


def sign(raw):
    return hmac.new(SECRET.encode(), raw, hashlib.sha512).hexdigest()


def invoice_status(invoice_id):
    with psycopg.connect(URL) as c:
        return c.execute('SELECT status FROM invoices WHERE id=%s', (invoice_id,)).fetchone()[0]


def test_the_key_is_sealed_to_its_business(paystack, live):
    sealed = keys.seal(live.business, SECRET)
    assert SECRET not in sealed and keys.unseal(live.business, sealed) == SECRET
    with pytest.raises(HTTPException, match='cannot be read'):
        keys.unseal(uuid4(), sealed)
    assert keys.hint(SECRET) == 'sk_test_...' + SECRET[-4:]


def test_a_customer_pays_an_invoice_online_and_the_payout_reaches_the_bank(paystack, live):
    with pytest.raises(HTTPException, match='Only an Owner or Admin'):
        connect(live, 'editor')
    settings = connect(live)
    assert (settings['connected'], settings['mode'], settings['key_hint']) == (True, 'test', 'sk_test_...' + SECRET[-4:])
    with psycopg.connect(URL) as c:
        stored, token = c.execute('SELECT secret_ciphertext,webhook_token FROM accounting.payment_provider WHERE business_id=%s', (live.business,)).fetchone()
        codes = {r[0] for r in c.execute('SELECT code FROM accounts WHERE business_id=%s', (live.business,))}
    assert SECRET not in stored and len(token) == 64 and {'1030', '2100', '6400'} <= codes
    assert 'webhook_token' not in call(live, 'editor', lambda s, a: op.settings(s, a))  # only managers see the webhook address

    first = invoice(live)
    link = call(live, 'editor', lambda s, a: op.share_link(s, a, first))
    assert call(live, 'editor', lambda s, a: op.share_link(s, a, first))['token'] == link['token']  # one live link per invoice
    summary = service.public_summary(link['token'])
    assert (summary['payable'], summary['needs_email'], summary['customer_name']) == ('65000.00', True, 'Ada Stores')
    assert 'email' not in json.dumps(summary).replace('needs_email', '')

    with pytest.raises(HTTPException, match='At most ₦65,000.00'):
        service.public_start(link['token'], op.PayStart(amount='70000', email='ada@example.com'))
    with pytest.raises(HTTPException, match='email address'):
        service.public_start(link['token'], op.PayStart(amount='40000'))
    started = service.public_start(link['token'], op.PayStart(amount='40000', email='ada@example.com'))
    reference = started['reference']
    assert started['authorization_url'].startswith('https://checkout.paystack.com/')
    assert paystack.started[-1]['amount_kobo'] == 4000000 and paystack.started[-1]['email'] == 'ada@example.com'

    # TEST-201: coming back from Paystack proves nothing. TEST-202: a forged webhook is refused. The event body says
    # success, but the verify call says the checkout was abandoned, so nothing posts.
    assert service.public_verify(link['token'], op.PayReturn(reference=reference))['status'] == 'pending'
    with pytest.raises(HTTPException) as refused:
        service.webhook(token, event(reference, 1), 'forged')
    assert refused.value.status_code == 401
    paystack.verified[reference] = {'status': 'abandoned', 'reference': reference}
    assert service.webhook(token, event(reference, 1), sign(event(reference, 1)))['outcome'] == 'not_paid'
    assert balance(live, '1030') == 0 and invoice_status(first) == 'sent'

    # TEST-203: the same valid webhook three times posts once.
    paystack.verified[reference] = success(reference, '40000', '700')
    receivable = balance(live, '1100')
    assert service.webhook(token, event(reference, 2), sign(event(reference, 2)))['outcome'] == 'posted'
    assert service.webhook(token, event(reference, 2), sign(event(reference, 2)))['outcome'] == 'duplicate'
    assert service.webhook(token, event(reference, 3), sign(event(reference, 3)))['outcome'] == 'already_posted'
    assert balance(live, '1030') == Decimal('40000') and receivable - balance(live, '1100') == Decimal('40000')
    assert invoice_status(first) == 'sent' and service.public_summary(link['token'])['payable'] == '25000.00'

    # The customer starts paying the rest; meanwhile the shop takes ₦10,000 cash. The money arrives anyway: the
    # invoice takes the ₦15,000 it still needs and the other ₦10,000 is kept as the customer's advance.
    second = service.public_start(link['token'], op.PayStart(amount='25000', email='ada@example.com'))['reference']
    call(live, 'owner', lambda s, a: receipt_create(s, a, ReceiptCreate(request_key=uuid4(), invoice_id=first, amount='10000', entry_date=TODAY, method='Cash')))
    paystack.verified[second] = success(second, '25000', '475')
    result = service.public_verify(link['token'], op.PayReturn(reference=second))
    assert result['status'] == 'posted' and invoice_status(first) == 'paid'
    assert balance(live, '1030') == Decimal('65000') and balance(live, '2100') == Decimal('-10000')
    assert result['summary']['payable'] == '0.00'
    with pytest.raises(HTTPException, match='Nothing is left to pay'):
        service.public_start(link['token'], op.PayStart(amount='1000', email='ada@example.com'))

    # TEST-204: an amount or currency Paystack did not confirm is held for review, never posted.
    other = invoice(live)
    other_link = call(live, 'owner', lambda s, a: op.share_link(s, a, other))['token']
    dollars = service.public_start(other_link, op.PayStart(amount='30000', email='ada@example.com'))['reference']
    paystack.verified[dollars] = {**success(dollars, '30000', '0'), 'currency': 'USD'}
    assert service.public_verify(other_link, op.PayReturn(reference=dollars))['status'] == 'needs_review'
    assert balance(live, '1030') == Decimal('65000') and invoice_status(other) == 'sent'

    # PR-15: the payout. The bank receives the net, the fees go to Bank and payment charges, clearing is emptied.
    # Money in the payout that did not come through a CACU link is held for review, not guessed at.
    bank, fees = balance(live, '1010'), balance(live, '6400')
    paystack.payouts = [{'id': 7001, 'status': 'success', 'settlement_date': TODAY.isoformat(), 'total_amount': 6382500},
                        {'id': 7002, 'status': 'pending', 'settlement_date': TODAY.isoformat(), 'total_amount': 100}]
    paystack.payout_items = {'7001': [{'reference': reference, 'amount': 4000000, 'fees': 70000},
                                      {'reference': second, 'amount': 2500000, 'fees': 47500}]}
    report = service.check_business(live.business, live.people['owner'])
    assert (report['payouts'], report['payouts_for_review']) == (1, 0)
    assert balance(live, '1010') - bank == Decimal('63825') and balance(live, '6400') - fees == Decimal('1175') and balance(live, '1030') == 0
    assert service.check_business(live.business, live.people['owner'])['payouts'] == 0  # recorded once

    third = service.public_start(other_link, op.PayStart(amount='30000', email='ada@example.com'))['reference']
    paystack.verified[third] = success(third, '30000', '550')
    paystack.payouts = [{'id': 7003, 'status': 'success', 'settlement_date': TODAY.isoformat(), 'total_amount': 4945000}]
    paystack.payout_items = {'7003': [{'reference': third, 'amount': 3000000, 'fees': 55000}, {'reference': 'shop-sale-1', 'amount': 2000000, 'fees': 30000}]}
    report = service.check_business(live.business, live.people['owner'], min_age_minutes=0)
    assert (report['posted'], report['payouts_for_review']) == (1, 1)  # the waiting checkout is verified by the job too
    overview = call(live, 'viewer', lambda s, a: op.overview(s, a))
    review = next(p for p in overview['payouts'] if p['id'] == '7003')
    assert (review['status'], review['net'], review['unmatched']) == ('needs_review', '29450.00', '19700.00')
    assert 'not from a CACU pay link' in review['note'] and overview['awaiting_payout'] == '0.00'
    assert next(p for p in overview['payments'] if p['reference'] == dollars)['review_reason'] == 'Paid in a currency other than naira.'
    with psycopg.connect(URL) as c, pytest.raises(psycopg.errors.CheckViolation, match='SETTLEMENT_RECORD_IMMUTABLE'):
        c.execute('UPDATE accounting.gateway_settlement SET fee=0 WHERE business_id=%s', (live.business,))
    with psycopg.connect(URL) as c, pytest.raises(psycopg.errors.CheckViolation, match='ONLINE_PAYMENT_ALREADY_DECIDED'):
        c.execute("UPDATE accounting.online_payment SET status='failed' WHERE reference=%s", (reference,))
    books_balance(live)

    # Withdrawing a link, or disconnecting Paystack, stops the link working.
    call(live, 'editor', lambda s, a: op.revoke_link(s, a, other))
    with pytest.raises(HTTPException, match='does not work'):
        service.public_summary(other_link)
    with pytest.raises(HTTPException, match='Only an Owner or Admin'):
        call(live, 'editor', lambda s, a: op.disconnect(s, a))
    call(live, 'admin', lambda s, a: op.disconnect(s, a))
    with pytest.raises(HTTPException, match='does not work'):
        service.public_summary(link['token'])
    with pytest.raises(HTTPException) as gone:
        service.webhook(token, event(reference, 9), sign(event(reference, 9)))
    assert gone.value.status_code == 404
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT secret_ciphertext FROM accounting.payment_provider WHERE business_id=%s', (live.business,)).fetchone()[0] is None


def test_links_need_paystack_and_an_issued_invoice_and_strangers_see_nothing(paystack, live):
    first = invoice(live)
    with pytest.raises(HTTPException, match='Connect Paystack'):
        call(live, 'editor', lambda s, a: op.share_link(s, a, first))
    connect(live)
    with pytest.raises(HTTPException, match='Only an issued invoice'):
        call(live, 'editor', lambda s, a: op.share_link(s, a, uuid4()))
    for token in ['not-a-token', '0' * 64]:
        with pytest.raises(HTTPException, match='does not work'):
            service.public_summary(token)
    with pytest.raises(HTTPException) as unknown:
        service.webhook('f' * 64, b'{}', 'x')
    assert unknown.value.status_code == 404
    # The runtime cannot read another business's connection; only the definer lookups cross businesses, by token.
    with psycopg.connect(URL) as c:
        c.execute('SET ROLE cacu_runtime')
        assert c.execute('SELECT count(*) FROM accounting.payment_provider').fetchone()[0] == 0
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            c.execute('SELECT accounting.payments_actor(%s,%s)', (live.business, live.people['owner']))
