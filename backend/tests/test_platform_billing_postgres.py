"""Trials, Paystack checkout and verified activation (Doc 14 SUB-01 to SUB-03, TEST-201 to TEST-204)."""
import hashlib
import hmac
import json
import os
from datetime import timedelta
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.billing import paystack, service
from cacu.billing.service import Checkout, Verification

URL = os.getenv('CACU_TEST_DATABASE_URL')
pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
MIGRATIONS = Path(__file__).resolve().parents[2] / 'supabase/migrations'
SECRET = 'sk_test_non-secret-fixture'
PAID_AT = '2026-11-02T10:00:00.000Z'


@pytest.fixture(autouse=True)
def database(monkeypatch):
    parsed = urlparse(URL)
    assert parsed.hostname in {'127.0.0.1', 'localhost'} and parsed.path.endswith('_test')
    with psycopg.connect(URL) as c:
        c.execute("""DROP SCHEMA IF EXISTS platform CASCADE; DROP SCHEMA IF EXISTS accounting CASCADE; DROP SCHEMA IF EXISTS auth CASCADE;
          DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE SCHEMA auth;
          DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated','cacu_runtime'] LOOP
            IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF; END LOOP; END $$;
          CREATE TABLE auth.users(id uuid PRIMARY KEY, email text);
          CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
          CREATE TABLE public.businesses(id uuid PRIMARY KEY, name text, business_type text NOT NULL, created_by uuid);
          CREATE TABLE public.memberships(business_id uuid, user_id uuid, role text, is_active boolean NOT NULL DEFAULT true);
          GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, cacu_runtime;
          GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;""")
        for name in ('20261102100000_platform_plans.sql', '20261102110000_platform_billing.sql'):
            c.execute((MIGRATIONS / name).read_text(encoding='utf-8'))

    def runtime():
        connection = psycopg.connect(URL, autocommit=True)
        connection.execute('SET ROLE cacu_runtime')
        return connection
    monkeypatch.setattr(service, 'connect', runtime)
    monkeypatch.setenv('PAYSTACK_SECRET_KEY', SECRET)
    yield


class FakePaystack:
    """Stands in for api.paystack.co: records initialisations and answers verify with what a test sets."""
    def __init__(self, monkeypatch):
        self.initialized, self.payments = [], {}
        monkeypatch.setattr(paystack, 'initialize', self.initialize)
        monkeypatch.setattr(paystack, 'verify', self.verify)

    def initialize(self, email, amount, reference, metadata):
        self.initialized.append((email, amount, reference))
        return f'https://checkout.paystack.com/{reference[-8:]}'

    def verify(self, reference):
        return self.payments.get(reference, {'status': 'abandoned', 'reference': reference})

    def pay(self, invoice, amount=None, currency='NGN'):
        self.payments[invoice['reference']] = {'status': 'success', 'reference': invoice['reference'], 'currency': currency,
                                               'amount': invoice['total_kobo'] if amount is None else amount,
                                               'paid_at': PAID_AT, 'channel': 'card'}


@pytest.fixture
def gateway(monkeypatch):
    return FakePaystack(monkeypatch)


def business(mode='PRODUCT'):
    ident, owner, editor = uuid4(), uuid4(), uuid4()
    with psycopg.connect(URL) as c:
        c.execute("INSERT INTO auth.users VALUES(%s,'ada@example.com'),(%s,'sule@example.com')", (owner, editor))
        c.execute('INSERT INTO businesses VALUES(%s,%s,%s,%s)', (ident, 'Ada Provisions', mode, owner))
        c.execute("INSERT INTO memberships VALUES(%s,%s,'owner',true),(%s,%s,'editor',true)", (ident, owner, ident, editor))
    return ident, owner, editor


def subscription(ident):
    with psycopg.connect(URL) as c:
        return c.execute('SELECT plan_code,status,current_period_start,current_period_end,grace_ends_at,billing_interval '
                         'FROM platform.subscriptions WHERE business_id=%s', (ident,)).fetchone()


def count(sql, *args):
    with psycopg.connect(URL) as c:
        return c.execute(sql, args).fetchone()[0]


def event(invoice, event_id=1, kind='charge.success'):
    body = json.dumps({'event': kind, 'data': {'id': event_id, 'reference': invoice['reference'], 'amount': 1}}).encode()
    return body, hmac.new(SECRET.encode(), body, hashlib.sha512).hexdigest()


def test_every_new_business_starts_a_14_day_oga_trial():
    ident, owner, _ = business()
    plan, status, start, end, grace, _ = subscription(ident)
    assert (plan, status, end - start, grace) == ('GROW', 'trialing', timedelta(days=14), None)
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT actor_kind,actor_id,reason FROM platform.subscription_changes WHERE business_id=%s', (ident,)).fetchall() == \
            [('system', owner, 'Trial started at setup')]


def test_a_hybrid_business_cannot_start_on_the_oga_trial():
    with pytest.raises(psycopg.errors.RaiseException, match='PLAN_LIMIT module.modes'):
        business('HYBRID')
    assert count('SELECT count(*) FROM businesses') == 0


@pytest.mark.parametrize('plan,interval,subtotal,vat', [('BASE', 'monthly', 150000, 11250), ('GROW', 'monthly', 600000, 45000),
                                                        ('TOP', 'monthly', 1500000, 112500), ('GROW', 'annual', 6000000, 450000),
                                                        ('TOP', 'annual', 15000000, 1125000)])
def test_checkout_adds_vat_to_the_plan_price(gateway, plan, interval, subtotal, vat):
    ident, owner, _ = business()
    data = Checkout(request_key=uuid4(), plan=plan, interval=interval)
    invoice = service.checkout(ident, owner, data)
    assert (invoice['subtotal_kobo'], invoice['vat_kobo'], invoice['total_kobo'], invoice['invoice']) == \
        (subtotal, vat, subtotal + vat, 'CACU-INV-000001')
    assert gateway.initialized == [('ada@example.com', subtotal + vat, invoice['reference'])]
    assert service.checkout(ident, owner, data) == invoice  # a retry reuses the reference and the checkout link
    assert len(gateway.initialized) == 1


def test_general_has_no_annual_price_and_only_owners_or_admins_check_out(gateway):
    ident, owner, editor = business()
    with pytest.raises(HTTPException) as refused:
        service.checkout(ident, owner, Checkout(request_key=uuid4(), plan='BASE', interval='annual'))
    assert refused.value.status_code == 422
    with pytest.raises(HTTPException) as refused:
        service.checkout(ident, editor, Checkout(request_key=uuid4(), plan='GROW'))
    assert refused.value.status_code == 403 and gateway.initialized == []


def test_returning_from_checkout_without_payment_changes_nothing(gateway):  # TEST-201
    ident, owner, _ = business()
    invoice = service.checkout(ident, owner, Checkout(request_key=uuid4(), plan='TOP'))
    assert service.verify_return(ident, owner, Verification(reference=invoice['reference'])) == {'outcome': 'not_paid'}
    assert subscription(ident)[:2] == ('GROW', 'trialing')


def test_forged_webhook_is_rejected_and_stores_nothing(gateway):  # TEST-202
    ident, owner, _ = business()
    invoice = service.checkout(ident, owner, Checkout(request_key=uuid4(), plan='TOP'))
    gateway.pay(invoice)
    body, _ = event(invoice)
    for signature in (None, 'f' * 128, hmac.new(b'sk_test_other', body, hashlib.sha512).hexdigest()):
        with pytest.raises(HTTPException) as refused:
            service.webhook(body, signature)
        assert refused.value.status_code == 401
    assert count('SELECT count(*) FROM platform.billing_events') == 0 and subscription(ident)[:2] == ('GROW', 'trialing')


def test_same_webhook_three_times_activates_once(gateway):  # TEST-203
    ident, owner, _ = business()
    invoice = service.checkout(ident, owner, Checkout(request_key=uuid4(), plan='TOP'))
    gateway.pay(invoice)
    body, signature = event(invoice)
    outcomes = [service.webhook(body, signature).get('outcome') for _ in range(3)]
    assert outcomes == ['activated', 'duplicate', 'duplicate']
    plan, status, start, end, grace, interval = subscription(ident)
    assert (plan, status, interval, grace) == ('TOP', 'active', 'monthly', None) and start.month + 1 == end.month
    assert count('SELECT count(*) FROM platform.receipts WHERE business_id=%s', ident) == 1
    assert count("SELECT count(*) FROM platform.subscription_changes WHERE business_id=%s AND to_status='active'", ident) == 1
    # The owner's return after the webhook reports the same single activation.
    assert service.verify_return(ident, owner, Verification(reference=invoice['reference'])) == {'outcome': 'already_applied'}


def test_a_short_payment_is_flagged_not_activated(gateway):  # TEST-204
    ident, owner, _ = business()
    invoice = service.checkout(ident, owner, Checkout(request_key=uuid4(), plan='TOP'))
    gateway.pay(invoice, amount=invoice['total_kobo'] - 100)
    body, signature = event(invoice)
    assert service.webhook(body, signature)['outcome'] == 'amount_or_currency_mismatch'
    assert subscription(ident)[:2] == ('GROW', 'trialing')
    assert count('SELECT status FROM platform.invoices WHERE reference=%s', invoice['reference']) == 'review'
    assert count('SELECT count(*) FROM platform.receipts') == 0


def test_a_retried_webhook_is_processed_when_the_first_attempt_failed(gateway, monkeypatch):
    ident, owner, _ = business()
    invoice = service.checkout(ident, owner, Checkout(request_key=uuid4(), plan='BASE'))
    gateway.pay(invoice)
    body, signature = event(invoice)
    def down(reference):
        raise HTTPException(502, 'Payment provider unavailable')
    monkeypatch.setattr(paystack, 'verify', down)
    with pytest.raises(HTTPException):
        service.webhook(body, signature)
    monkeypatch.setattr(paystack, 'verify', gateway.verify)
    assert service.webhook(body, signature)['outcome'] == 'activated'


def test_other_references_and_events_are_acknowledged_without_action(gateway):
    body = json.dumps({'event': 'charge.success', 'data': {'id': 9, 'reference': 'tenant-sale-123'}}).encode()
    assert service.webhook(body, hmac.new(SECRET.encode(), body, hashlib.sha512).hexdigest()) == {'received': True}
    assert count('SELECT count(*) FROM platform.billing_events') == 0


def test_trial_ends_on_general_with_grace_then_read_only_until_paid(gateway):
    ident, owner, _ = business()
    with psycopg.connect(URL) as c:
        c.execute("SELECT set_config('platform.reason','test: trial elapsed',true)")
        c.execute("UPDATE platform.subscriptions SET current_period_start=now()-interval '14 days', current_period_end=now()-interval '1 minute' WHERE business_id=%s", (ident,))
        assert c.execute('SELECT platform.end_trials()').fetchone()[0] == 1
    plan, status, _, end, grace, _ = subscription(ident)
    assert (plan, status, grace - end) == ('BASE', 'incomplete', timedelta(days=7))
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT platform.suspend_unpaid()').fetchone()[0] == 0  # still inside grace
        assert c.execute('SELECT platform.suspend_unpaid(%s)', (grace,)).fetchone()[0] == 1
        assert c.execute('SELECT platform.writes_allowed(%s)', (ident,)).fetchone()[0] is False
    invoice = service.checkout(ident, owner, Checkout(request_key=uuid4(), plan='BASE'))
    gateway.pay(invoice)
    assert service.verify_return(ident, owner, Verification(reference=invoice['reference']))['outcome'] == 'activated'
    assert subscription(ident)[:2] == ('BASE', 'active')
    with pytest.raises(HTTPException) as refused:
        service.checkout(ident, owner, Checkout(request_key=uuid4(), plan='TOP'))
    assert refused.value.status_code == 409  # plan changes while active come with proration


def test_owners_see_their_billing_history_and_others_see_nothing(gateway):
    ident, owner, editor = business()
    invoice = service.checkout(ident, owner, Checkout(request_key=uuid4(), plan='GROW', interval='annual'))
    gateway.pay(invoice)
    service.verify_return(ident, owner, Verification(reference=invoice['reference']))

    def history(actor):
        with psycopg.connect(URL) as c:
            c.execute('SET LOCAL ROLE authenticated')
            c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': str(actor)}),))
            return c.execute('SELECT public.business_billing_history(%s)', (ident,)).fetchone()[0]
    rows = history(owner)
    assert [(r['invoice'], r['receipt'], r['total_kobo'], r['status']) for r in rows] == [('CACU-INV-000001', 'CACU-RCT-000001', 6450000, 'paid')]
    for outsider in (editor, uuid4()):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            history(outsider)
    with pytest.raises(HTTPException) as refused:
        service.verify_return(ident, uuid4(), Verification(reference=invoice['reference']))
    assert refused.value.status_code == 403
    with psycopg.connect(URL) as c:
        for role in ('authenticated', 'cacu_runtime'):
            for table in ('invoices', 'receipts', 'billing_events', 'settings', 'subscriptions'):
                assert not c.execute("SELECT has_table_privilege(%s,%s,'SELECT')", (role, 'platform.' + table)).fetchone()[0]
