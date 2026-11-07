"""Trials, Paystack checkout, verified activation, plan changes and renewals (Doc 14 SUB-01 to SUB-08, TEST-201 to TEST-204)."""
import hashlib
import hmac
import json
import os
from datetime import timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.billing import paystack, service
from cacu.billing.service import Checkout, PlanChange, Verification

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
        c.execute("""DROP SCHEMA IF EXISTS ai_private CASCADE; DROP SCHEMA IF EXISTS ops CASCADE; DROP SCHEMA IF EXISTS platform CASCADE; DROP SCHEMA IF EXISTS accounting CASCADE; DROP SCHEMA IF EXISTS auth CASCADE;
          DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE SCHEMA auth;
          DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated','cacu_runtime'] LOOP
            IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF; END LOOP; END $$;
          CREATE TABLE auth.users(id uuid PRIMARY KEY, email text);
          CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
          CREATE TABLE public.businesses(id uuid PRIMARY KEY, name text, business_type text NOT NULL, created_by uuid, phone_number text);
          CREATE TABLE public.memberships(business_id uuid, user_id uuid, role text, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
          CREATE TABLE public.business_invitations(business_id uuid, status text, expires_at timestamptz);
          CREATE TABLE public.business_locations(business_id uuid, is_active boolean NOT NULL DEFAULT true, id uuid NOT NULL DEFAULT gen_random_uuid(), name text, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
          CREATE TABLE public.catalog_items(business_id uuid, is_active boolean);
          GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, cacu_runtime;
          GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;""")
        for name in ('20261012132427_guarded_ai_chat.sql', '20261102090100_ai_active_members.sql',
                     '20261102100000_platform_plans.sql', '20261102110000_platform_billing.sql', '20261102120000_ops_scheduled_jobs.sql',
                     '20261102130000_plan_limits.sql', '20261102140000_plan_changes.sql', '20261102150000_renewals.sql',
                     '20261104090000_ai_plan_quota.sql', '20261104100000_interval_changes.sql',
                     '20261104110000_billing_history_details.sql', '20261104120000_billing_notifications.sql', '20261104130000_plan_limit_values.sql',
                     '20261105100000_cancel_and_downgrade_choices.sql'):
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
        self.initialized, self.payments, self.charges, self.decline = [], {}, [], False
        monkeypatch.setattr(paystack, 'initialize', self.initialize)
        monkeypatch.setattr(paystack, 'verify', self.verify)
        monkeypatch.setattr(paystack, 'charge_authorization', self.charge_authorization)

    def charge_authorization(self, code, email, amount, reference, metadata):
        self.charges.append((code, email, amount, reference))
        if self.decline:
            return {'status': 'failed', 'gateway_response': 'Insufficient Funds'}
        self.pay({'reference': reference, 'total_kobo': amount})
        return {'status': 'success', 'gateway_response': 'Approved'}

    def initialize(self, email, amount, reference, metadata):
        self.initialized.append((email, amount, reference))
        return f'https://checkout.paystack.com/{reference[-8:]}'

    def verify(self, reference):
        return self.payments.get(reference, {'status': 'abandoned', 'reference': reference})

    def pay(self, invoice, amount=None, currency='NGN'):
        self.payments[invoice['reference']] = {'status': 'success', 'reference': invoice['reference'], 'currency': currency,
                                               'amount': invoice['total_kobo'] if amount is None else amount,
                                               'paid_at': PAID_AT, 'channel': 'card', 'customer': {'email': 'ada@example.com'},
                                               'authorization': {'authorization_code': 'AUTH_fixture1', 'reusable': True, 'channel': 'card',
                                                                 'last4': '4081', 'card_type': 'visa', 'bank': 'TEST BANK',
                                                                 'exp_month': '12', 'exp_year': '2030'}}


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
        service.checkout(ident, owner, Checkout(request_key=uuid4(), plan='BASE'))
    assert refused.value.status_code == 409  # already on this plan for the period


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
    # What the PDF invoice and receipt print (SUB-14).
    assert (rows[0]['vat_rate_bps'], rows[0]['channel'], rows[0]['receipt_amount_kobo'], rows[0]['kind'], rows[0]['billing_interval']) == \
        (750, 'card', 6450000, 'subscription', 'annual')
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


def run_job(name):
    with psycopg.connect(URL) as c:
        return c.execute('SELECT ops.run_job(%s)', (name,)).fetchone()[0]


def test_scheduled_jobs_end_trials_and_suspend_and_log_every_run():
    ident, _, _ = business()
    assert run_job('billing.end_trials') == {'job': 'billing.end_trials', 'ok': True, 'changed': 0}
    with psycopg.connect(URL) as c:
        c.execute("SELECT set_config('platform.reason','test: trial elapsed',true)")
        c.execute("UPDATE platform.subscriptions SET current_period_start=now()-interval '22 days', current_period_end=now()-interval '8 days' WHERE business_id=%s", (ident,))
    assert run_job('billing.end_trials')['changed'] == 1
    assert run_job('billing.suspend_unpaid')['changed'] == 1  # trial ended 8 days ago, so the 7-day grace is over
    assert subscription(ident)[:2] == ('BASE', 'suspended')
    with psycopg.connect(URL) as c:
        runs = c.execute('SELECT job, ok, changed, error FROM ops.job_runs ORDER BY id').fetchall()
    assert runs == [('billing.end_trials', True, 0, None), ('billing.end_trials', True, 1, None), ('billing.suspend_unpaid', True, 1, None)]


def test_a_failing_job_is_logged_and_changes_nothing():
    ident, _, _ = business()
    with psycopg.connect(URL) as c:
        c.execute("SELECT set_config('platform.reason','test: trial elapsed',true)")
        c.execute("UPDATE platform.subscriptions SET current_period_start=now()-interval '15 days', current_period_end=now()-interval '1 day' WHERE business_id=%s", (ident,))
        # Break the job: with no settings row the trial cannot know which plan follows it.
        c.execute('ALTER TABLE platform.settings DISABLE TRIGGER settings_audit')
        c.execute('DELETE FROM platform.settings')
    result = run_job('billing.end_trials')
    assert result['ok'] is False and result['error']
    assert subscription(ident)[:2] == ('GROW', 'trialing')
    assert count('SELECT count(*) FROM ops.job_runs WHERE NOT ok') == 1
    with pytest.raises(psycopg.errors.InvalidParameterValue, match='UNKNOWN_JOB'):
        run_job('billing.delete_everything')


def test_jobs_are_not_callable_by_users_or_the_runtime():
    with psycopg.connect(URL) as c:
        for role in ('anon', 'authenticated', 'cacu_runtime'):
            assert not c.execute("SELECT has_function_privilege(%s, 'ops.run_job(text)', 'EXECUTE')", (role,)).fetchone()[0]
            assert not c.execute("SELECT has_table_privilege(%s, 'ops.job_runs', 'SELECT')", (role,)).fetchone()[0]


def activate(ident, plan, start='10 days', end='20 days', interval='monthly'):
    """A paid period that began `start` ago and ends in `end`."""
    with psycopg.connect(URL) as c:
        c.execute("SELECT set_config('platform.reason','test: paid period',true)")
        c.execute(f"UPDATE platform.subscriptions SET plan_code=%s, status='active', billing_interval=%s, grace_ends_at=NULL, "
                  f"current_period_start=now()-interval '{start}', current_period_end=now()+interval '{end}' WHERE business_id=%s",
                  (plan, interval, ident))


def refusal(call):
    with pytest.raises(HTTPException) as refused:
        call()
    return refused.value.status_code, refused.value.detail


def test_an_upgrade_charges_the_prorated_difference_and_keeps_the_period_end(gateway):  # SUB-05
    ident, owner, _ = business()
    activate(ident, 'GROW')
    before = subscription(ident)
    invoice = service.checkout(ident, owner, Checkout(request_key=uuid4(), plan='TOP'))
    # (₦15,000 - ₦6,000) for 20 of 30 days = ₦6,000, plus 7.5% VAT.
    assert (invoice['kind'], invoice['subtotal_kobo'], invoice['vat_kobo'], invoice['total_kobo']) == ('upgrade', 600000, 45000, 645000)
    gateway.pay(invoice)
    assert service.verify_return(ident, owner, Verification(reference=invoice['reference']))['outcome'] == 'activated'
    after = subscription(ident)
    assert after[:2] == ('TOP', 'active') and after[2:4] == before[2:4]
    assert count("SELECT platform.entitlement(%s,'users.max')", ident) == 50


def test_only_upgrades_on_the_same_interval_are_paid_mid_period(gateway):
    ident, owner, editor = business()
    activate(ident, 'GROW')
    checkout = lambda actor=owner, **kw: service.checkout(ident, actor, Checkout(request_key=uuid4(), **kw))
    assert refusal(lambda: checkout(plan='GROW'))[0] == 409
    assert 'scheduled' in refusal(lambda: checkout(plan='BASE'))[1]
    assert refusal(lambda: checkout(editor, plan='TOP'))[0] == 403
    activate(ident, 'GROW', start='29 days 20 hours', end='4 hours')
    assert 'Renew first' in refusal(lambda: checkout(plan='TOP'))[1]
    assert gateway.initialized == []


def test_an_upgrade_paid_after_its_period_changed_is_flagged_not_applied(gateway):
    ident, owner, _ = business()
    activate(ident, 'GROW')
    invoice = service.checkout(ident, owner, Checkout(request_key=uuid4(), plan='TOP'))
    activate(ident, 'GROW', start='1 day', end='29 days')  # renewed in the meantime
    gateway.pay(invoice)
    assert service.verify_return(ident, owner, Verification(reference=invoice['reference']))['outcome'] == 'upgrade_no_longer_applies'
    assert subscription(ident)[0] == 'GROW'
    assert count('SELECT status FROM platform.invoices WHERE reference=%s', invoice['reference']) == 'review'
    assert count('SELECT count(*) FROM platform.receipts') == 0


def test_a_downgrade_is_scheduled_shows_what_is_over_and_applies_when_the_period_ends(gateway):  # SUB-06
    ident, owner, editor = business()
    activate(ident, 'TOP')
    with psycopg.connect(URL) as c:
        c.execute('INSERT INTO business_locations SELECT %s FROM generate_series(1,3)', (ident,))
    scheduled = service.schedule(ident, owner, PlanChange(plan='BASE'))
    assert scheduled['scheduled_plan'] == 'BASE' and scheduled['over_limits'] == {'outlets.max': {'used': 3, 'limit': 1}}
    assert subscription(ident)[0] == 'TOP'  # nothing changes until the period ends
    assert service.schedule(ident, owner, PlanChange(plan='TOP'))['scheduled_plan'] is None  # cancelled
    service.schedule(ident, owner, PlanChange(plan='GROW'))
    assert refusal(lambda: service.schedule(ident, editor, PlanChange(plan='BASE')))[0] == 403
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT platform.end_periods()').fetchone()[0] == 0
        assert c.execute("SELECT platform.end_periods(now()+interval '21 days')").fetchone()[0] == 1
    plan, status, _, end, grace, _ = subscription(ident)
    assert (plan, status, grace - end) == ('GROW', 'past_due', timedelta(days=7))
    assert 'no paid period' in refusal(lambda: service.schedule(ident, owner, PlanChange(plan='BASE')))[1]
    with psycopg.connect(URL) as c:
        reasons = [r for (r,) in c.execute('SELECT reason FROM platform.subscription_changes WHERE business_id=%s ORDER BY id', (ident,))]
    assert reasons[-3:] == ['Scheduled plan change cancelled', 'Downgrade to Oga scheduled for the end of the period', 'Paid period ended; renewal due']


def test_upgrades_are_not_scheduled(gateway):
    ident, owner, _ = business()
    activate(ident, 'GROW')
    assert 'checkout' in refusal(lambda: service.schedule(ident, owner, PlanChange(plan='TOP')))[1]


def test_a_hybrid_business_keeps_chairman_until_it_changes_mode(gateway):
    ident, owner, _ = business()
    activate(ident, 'TOP')
    service.schedule(ident, owner, PlanChange(plan='GROW'))
    with psycopg.connect(URL) as c:
        c.execute("UPDATE businesses SET business_type='HYBRID' WHERE id=%s", (ident,))
    assert refusal(lambda: service.schedule(ident, owner, PlanChange(plan='BASE')))[0] == 403
    assert run_job('billing.end_periods')['changed'] == 0
    with psycopg.connect(URL) as c:
        c.execute("SELECT platform.end_periods(now()+interval '21 days')")
    assert subscription(ident)[:2] == ('TOP', 'past_due')


def test_upgrade_invoices_show_in_history_as_upgrades(gateway):
    ident, owner, _ = business()
    activate(ident, 'BASE')
    service.checkout(ident, owner, Checkout(request_key=uuid4(), plan='GROW'))
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE authenticated')
        c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': str(owner)}),))
        rows = c.execute('SELECT public.business_billing_history(%s)', (ident,)).fetchone()[0]
    assert [(r['kind'], r['plan'], r['status']) for r in rows] == [('upgrade', 'GROW', 'open')]


def plan_as(ident, actor):
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE authenticated')
        c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': str(actor)}),))
        return c.execute('SELECT public.business_plan(%s)', (ident,)).fetchone()[0]


def paid_with_card(gateway, ident, owner, plan='GROW'):
    invoice = service.checkout(ident, owner, Checkout(request_key=uuid4(), plan=plan))
    gateway.pay(invoice)
    assert service.verify_return(ident, owner, Verification(reference=invoice['reference']))['outcome'] == 'activated'


def renewals(now="now()"):
    with psycopg.connect(URL) as c:
        return c.execute(f'SELECT platform.issue_renewals({now})').fetchone()[0]


def open_renewal(ident):
    with psycopg.connect(URL) as c:
        return c.execute("SELECT plan_code, period_start, total_kobo, reference FROM platform.invoices "
                         "WHERE business_id=%s AND kind='renewal' AND status='open'", (ident,)).fetchone()


def test_a_paid_card_is_saved_shown_to_managers_only_and_can_be_removed(gateway):
    ident, owner, editor = business()
    paid_with_card(gateway, ident, owner)
    assert plan_as(ident, owner)['card'] == {'card_type': 'visa', 'bank': 'TEST BANK', 'last4': '4081', 'exp_month': '12', 'exp_year': '2030'}
    assert plan_as(ident, editor)['card'] is None
    assert plan_as(ident, editor)['usage'] == {'users.max': 2, 'outlets.max': 0, 'catalog.max_items': 0, 'ai.queries_per_month': 0}
    for role in ('authenticated', 'cacu_runtime'):
        assert count("SELECT has_table_privilege(%s, 'platform.payment_methods', 'SELECT')", role) is False
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE authenticated')
        c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': str(editor)}),))
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            c.execute('SELECT public.remove_payment_method(%s)', (ident,))
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE authenticated')
        c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': str(owner)}),))
        c.execute('SELECT public.remove_payment_method(%s)', (ident,))
    assert plan_as(ident, owner)['card'] is None


def test_renewal_invoices_are_issued_three_days_ahead_once_and_follow_plan_changes(gateway):  # SUB-04
    ident, owner, _ = business()
    activate(ident, 'GROW', start='28 days', end='2 days')
    end = subscription(ident)[3]
    assert renewals() == 1 and renewals() == 0
    plan, starts, total, _ = open_renewal(ident)
    assert (plan, starts, total) == ('GROW', end, 645000)
    assert plan_as(ident, owner)['renewal']['invoice'] == count("SELECT number FROM platform.invoices WHERE kind='renewal'")
    service.schedule(ident, owner, PlanChange(plan='BASE'))  # the open invoice no longer matches: voided, then reissued
    assert open_renewal(ident) is None and renewals() == 1
    assert open_renewal(ident)[:3] == ('BASE', end, 161250)
    with psycopg.connect(URL) as c:  # the period ends with the downgrade applied: the reissued invoice still applies
        c.execute("SELECT platform.end_periods(now()+interval '3 days')")
    assert subscription(ident)[:2] == ('BASE', 'past_due') and open_renewal(ident)[0] == 'BASE'


def test_a_saved_card_is_charged_on_the_due_date_and_the_new_period_follows_on(gateway):
    ident, owner, _ = business()
    paid_with_card(gateway, ident, owner)
    activate(ident, 'GROW', start='29 days 21 hours', end='3 hours')
    end = subscription(ident)[3]
    renewals()
    assert service.renew_due() == {'due': 1, 'activated': 1, 'declined': 0, 'pending': 0}
    assert gateway.charges[0][:3] == ('AUTH_fixture1', 'ada@example.com', 645000)
    plan, status, start, new_end, _, _ = subscription(ident)
    assert (plan, status, start) == ('GROW', 'active', end) and new_end.month == (end.month % 12) + 1
    assert count("SELECT count(*) FROM platform.charge_attempts WHERE outcome='activated'") == 1
    assert service.renew_due()['due'] == 0


def test_a_declined_card_is_retried_on_days_1_3_and_5_then_the_owner_pays_by_link(gateway):  # SUB-08
    ident, owner, _ = business()
    paid_with_card(gateway, ident, owner)
    activate(ident, 'GROW', start='29 days 21 hours', end='3 hours')
    end = subscription(ident)[3]
    renewals()
    gateway.decline = True
    assert service.renew_due() == {'due': 1, 'activated': 0, 'declined': 1, 'pending': 0}
    assert service.renew_due()['due'] == 0  # not again until day 1 of grace
    assert plan_as(ident, owner)['renewal']['last_failure'] == 'Insufficient Funds'
    reference = open_renewal(ident)[3]
    with psycopg.connect(URL) as c:
        due_on = [c.execute('SELECT platform.due_card_charges(%s::timestamptz + %s::interval)', (end, after)).fetchone()[0]
                  for after in ('23 hours', '1 day', '3 days')]
        assert due_on == [[], [reference], [reference]]
        invoice_id = c.execute('SELECT id FROM platform.invoices WHERE reference=%s', (reference,)).fetchone()[0]
        for attempt in (2, 3, 4):
            c.execute("INSERT INTO platform.charge_attempts(reference, invoice_id, attempt, finished_at, outcome) VALUES (%s,%s,%s,now(),'declined')",
                      ('CACU-REN-' + uuid4().hex, invoice_id, attempt))
        assert c.execute("SELECT platform.due_card_charges(now()+interval '30 days')").fetchone()[0] == []
        c.execute("SELECT platform.end_periods(now()+interval '4 hours')")
    assert subscription(ident)[1] == 'past_due'
    gateway.decline = False
    link = service.renewal_checkout(ident, owner)
    assert link['reference'] == reference and link['authorization_url'].startswith('https://checkout.paystack.com/')
    gateway.pay(link)
    assert service.verify_return(ident, owner, Verification(reference=reference))['outcome'] == 'activated'
    assert subscription(ident)[1:3] == ('active', end)  # paid inside grace: no days lost


def test_a_renewal_paid_after_a_fresh_plan_was_bought_is_flagged(gateway):
    ident, owner, _ = business()
    activate(ident, 'GROW', start='28 days', end='2 days')
    renewals()
    stale = service.renewal_checkout(ident, owner)
    with psycopg.connect(URL) as c:  # the period moves on another way first (for example support re-dates it)
        c.execute("SELECT set_config('platform.reason','test: re-dated',true)")
        c.execute("UPDATE platform.subscriptions SET current_period_end=current_period_end+interval '1 day' WHERE business_id=%s", (ident,))
    gateway.pay(stale)
    assert service.verify_return(ident, owner, Verification(reference=stale['reference']))['outcome'] == 'invoice_void'
    assert count('SELECT status FROM platform.invoices WHERE reference=%s', stale['reference']) == 'review'
    assert count('SELECT count(*) FROM platform.receipts') == 0
    with pytest.raises(HTTPException) as refused:
        service.renewal_checkout(uuid4(), owner)
    assert refused.value.status_code == 403


def test_the_renewal_operator_reports_counts_only(gateway, capsys):
    from tools.renew_subscriptions import main
    ident, owner, _ = business()
    paid_with_card(gateway, ident, owner)
    activate(ident, 'GROW', start='29 days 21 hours', end='3 hours')
    renewals()
    assert main(['--json']) == 0
    assert json.loads(capsys.readouterr().out) == {'mode': 'dry-run', 'status': 'ok', 'due': 1}
    assert gateway.charges == []
    assert main(['--apply', '--json']) == 0
    out = capsys.readouterr().out
    assert json.loads(out) == {'mode': 'apply', 'status': 'ok', 'due': 1, 'activated': 1, 'declined': 0, 'pending': 0}
    assert 'AUTH_' not in out and 'ada@' not in out


def quote(ident, actor, plan, interval):
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE authenticated')
        c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': str(actor)}),))
        return c.execute('SELECT public.billing_quote(%s,%s,%s)', (ident, plan, interval)).fetchone()[0]


@pytest.mark.parametrize('plan,subtotal', [('GROW', 5600000), ('TOP', 14600000)])
def test_monthly_to_yearly_is_paid_now_less_the_unused_month_and_starts_a_year(gateway, plan, subtotal):  # SUB-07
    ident, owner, _ = business()
    activate(ident, 'GROW')
    # Yearly price less the unused 20 of 30 days of Oga monthly (₦4,000), plus VAT; quoted before payment (SUB-R05).
    shown = quote(ident, owner, plan, 'annual')
    assert (shown['subtotal_kobo'], shown['credit_kobo'], shown['vat_kobo']) == (subtotal, 400000, subtotal * 75 // 1000)
    invoice = service.checkout(ident, owner, Checkout(request_key=uuid4(), plan=plan, interval='annual'))
    assert (invoice['kind'], invoice['total_kobo']) == ('upgrade', shown['total_kobo'])
    gateway.pay(invoice)
    assert service.verify_return(ident, owner, Verification(reference=invoice['reference']))['outcome'] == 'activated'
    plan_code, status, start, end, _, interval = subscription(ident)
    assert (plan_code, status, interval) == (plan, 'active', 'annual') and end.year == start.year + 1 and start.astimezone(timezone.utc).isoformat().startswith('2026-11-02T10:00')


def test_yearly_to_monthly_waits_for_the_end_of_the_year_and_renews_monthly(gateway):
    ident, owner, _ = business()
    activate(ident, 'GROW', start='300 days', end='2 days', interval='annual')
    assert 'end of the year' in refusal(lambda: service.checkout(ident, owner, Checkout(request_key=uuid4(), plan='GROW')))[1]
    scheduled = service.schedule(ident, owner, PlanChange(plan='GROW', interval='monthly'))
    assert (scheduled['scheduled_plan'], scheduled['scheduled_interval']) == (None, 'monthly')
    assert plan_as(ident, owner)['scheduled_interval'] == 'monthly'
    renewals()
    assert open_renewal(ident)[:3][0::2] == ('GROW', 645000)  # one month of Oga, not a year
    assert service.schedule(ident, owner, PlanChange(plan='GROW', interval='annual'))['scheduled_interval'] is None  # cancelled
    assert open_renewal(ident) is None and renewals() == 1 and open_renewal(ident)[2] == 6450000
    service.schedule(ident, owner, PlanChange(plan='BASE'))  # General has no yearly price: it renews monthly
    assert renewals() == 1 and open_renewal(ident)[0::2] == ('BASE', 161250)
    with psycopg.connect(URL) as c:
        c.execute("SELECT platform.end_periods(now()+interval '3 days')")
    plan, status, _, _, _, interval = subscription(ident)
    assert (plan, status, interval) == ('BASE', 'past_due', 'monthly')
    with psycopg.connect(URL) as c:
        reasons = [r for (r,) in c.execute('SELECT reason FROM platform.subscription_changes WHERE business_id=%s ORDER BY id', (ident,))]
    assert 'Switch to monthly billing scheduled for the end of the period' in reasons


def test_quotes_are_for_owners_and_admins_and_refuse_what_checkout_refuses(gateway):
    ident, owner, editor = business()
    activate(ident, 'TOP')
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        quote(ident, editor, 'TOP', 'annual')
    with pytest.raises(psycopg.errors.RaiseException, match='BILLING_DOWNGRADE_IS_SCHEDULED'):
        quote(ident, owner, 'GROW', 'annual')  # a smaller plan, even yearly, is scheduled
    assert 'checkout' in refusal(lambda: service.schedule(ident, owner, PlanChange(plan='TOP', interval='annual')))[1]
    assert service.schedule(ident, owner, PlanChange(plan='GROW', interval='annual'))['scheduled_interval'] == 'annual'


def queue(now='now()'):
    with psycopg.connect(URL) as c:
        return c.execute(f'SELECT platform.queue_notifications({now})').fetchone()[0]


def outbox(ident=None):
    with psycopg.connect(URL) as c:
        return c.execute("SELECT kind, channel, status, dedupe_key FROM platform.notifications WHERE %s::uuid IS NULL OR business_id=%s ORDER BY id",
                         (ident, ident)).fetchall()


class FakeProviders:
    """Stands in for Resend and Termii: records what would be sent, and can refuse."""
    def __init__(self, monkeypatch):
        from cacu.billing import notify
        self.sent, self.refuse = [], False
        for name, value in {'RESEND_API_KEY': 're_test_fixture', 'CACU_EMAIL_FROM': 'CACU <billing@example.com>', 'TERMII_API_KEY': 'termii-fixture',
                            'TERMII_SENDER_ID': 'CACU', 'CACU_APP_URL': 'https://app.example.com'}.items():
            monkeypatch.setenv(name, value)
        monkeypatch.setattr(notify, '_post', self.post)

    def post(self, url, **kwargs):
        from cacu.billing.notify import SendFailed
        if self.refuse:
            raise SendFailed('provider_refused_500')
        self.sent.append((url, kwargs))
        return {'id': 'email-1'} if 'resend' in url else {'message_id': 'sms-1'}


def test_trial_reminders_are_queued_four_days_and_one_day_before_once_per_channel():
    ident, _, _ = business()
    with psycopg.connect(URL) as c:
        c.execute("SELECT set_config('platform.reason','test: trial nearly over',true)")
        c.execute("UPDATE platform.subscriptions SET current_period_end=now()+interval '3 days' WHERE business_id=%s", (ident,))
    assert queue() == 1 and queue() == 0  # email only: no business phone yet
    with psycopg.connect(URL) as c:
        c.execute("UPDATE businesses SET phone_number='0803 123 4567' WHERE id=%s", (ident,))
    assert queue() == 1  # the SMS for the same reminder
    assert queue("now()+interval '2 days 12 hours'") == 2  # one day left: email and SMS
    assert [(k, ch) for k, ch, _, _ in outbox(ident)] == [('trial_ending', 'email'), ('trial_ending', 'sms'), ('trial_ending', 'email'), ('trial_ending', 'sms')]


def test_renewal_decline_grace_and_read_only_each_queue_a_reminder(gateway):
    ident, owner, _ = business()
    paid_with_card(gateway, ident, owner)
    activate(ident, 'GROW', start='29 days 21 hours', end='3 hours')
    renewals()
    gateway.decline = True
    service.renew_due()
    queue()
    assert sorted({k for k, _, _, _ in outbox(ident)}) == ['card_declined', 'renewal_due']
    with psycopg.connect(URL) as c:
        c.execute("SELECT platform.end_periods(now()+interval '4 hours')")
    queue()
    with psycopg.connect(URL) as c:
        c.execute("SELECT platform.suspend_unpaid(now()+interval '8 days')")
    queue()
    assert sorted(k for k, _, _, _ in outbox(ident)) == ['card_declined', 'payment_due', 'renewal_due', 'suspended']  # once each


def test_reminders_go_to_owners_by_email_and_the_business_phone_by_sms(monkeypatch):
    from cacu.billing import notify
    providers = FakeProviders(monkeypatch)
    ident, _, _ = business()
    with psycopg.connect(URL) as c:
        c.execute("UPDATE businesses SET phone_number='+234 803 123 4567' WHERE id=%s", (ident,))
        c.execute("SELECT set_config('platform.reason','test: trial nearly over',true)")
        c.execute("UPDATE platform.subscriptions SET current_period_end='2026-11-16T10:00:00Z' WHERE business_id=%s", (ident,))
    queue("'2026-11-13T10:00:00Z'::timestamptz")
    with psycopg.connect(URL) as c:
        c.execute("UPDATE platform.notifications SET created_at=now()")
    assert notify.send_due() == {'channels': ['email', 'sms'], 'claimed': 2, 'sent': 2, 'failed': 0, 'skipped': 0}
    (email_url, email), (sms_url, sms) = providers.sent
    assert email_url == 'https://api.resend.com/emails' and email['json']['to'] == ['ada@example.com']  # the owner, not the editor
    assert email['json']['subject'] == 'Your CACU trial ends on 16 Nov 2026' and 'https://app.example.com/settings/billing' in email['json']['text']
    assert email['headers']['Idempotency-Key'].startswith('cacu-notification-')
    assert sms_url == 'https://api.ng.termii.com/api/sms/send' and sms['json']['to'] == '2348031234567' and sms['json']['sms'].startswith('CACU: ')
    assert {status for _, _, status, _ in outbox(ident)} == {'sent'}
    assert notify.send_due()['claimed'] == 0


def test_failures_retry_after_an_hour_up_to_three_times_and_stale_reminders_are_dropped(monkeypatch):
    from cacu.billing import notify
    providers = FakeProviders(monkeypatch)
    ident, _, _ = business()
    with psycopg.connect(URL) as c:
        c.execute("SELECT set_config('platform.reason','test: trial nearly over',true)")
        c.execute("UPDATE platform.subscriptions SET current_period_end=now()+interval '3 days' WHERE business_id=%s", (ident,))
    queue()
    providers.refuse = True
    assert notify.send_due()['failed'] == 1 and notify.send_due()['claimed'] == 0  # not again within the hour
    for _ in range(2):
        with psycopg.connect(URL) as c:
            c.execute("UPDATE platform.notifications SET claimed_at=claimed_at-interval '2 hours'")
        assert notify.send_due()['failed'] == 1
    with psycopg.connect(URL) as c:
        c.execute("UPDATE platform.notifications SET claimed_at=claimed_at-interval '2 hours'")
    assert notify.send_due()['claimed'] == 0  # three attempts used
    with psycopg.connect(URL) as c:
        c.execute("UPDATE platform.notifications SET created_at=now()-interval '4 days', attempts=0, status='queued'")
    assert notify.send_due()['claimed'] == 0 and outbox(ident)[0][2] == 'skipped'


def test_a_channel_without_keys_stays_queued_and_the_operator_reports_counts_only(monkeypatch, capsys):
    from tools.send_notifications import main
    for name in ('RESEND_API_KEY', 'CACU_EMAIL_FROM', 'TERMII_API_KEY', 'TERMII_SENDER_ID'):
        monkeypatch.delenv(name, raising=False)
    ident, _, _ = business()
    with psycopg.connect(URL) as c:
        c.execute("SELECT set_config('platform.reason','test: trial nearly over',true)")
        c.execute("UPDATE platform.subscriptions SET current_period_end=now()+interval '3 days' WHERE business_id=%s", (ident,))
    queue()
    assert main(['--apply', '--json']) == 0
    assert json.loads(capsys.readouterr().out) == {'mode': 'apply', 'status': 'ok', 'channels': [], 'claimed': 0, 'sent': 0, 'failed': 0, 'skipped': 0}
    assert outbox(ident)[0][2] == 'queued'
    providers = FakeProviders(monkeypatch)
    assert main(['--apply', '--json']) == 0
    out = capsys.readouterr().out
    assert json.loads(out)['sent'] == 1 and 'ada@' not in out and len(providers.sent) == 1
    with psycopg.connect(URL) as c:
        for role in ('authenticated', 'cacu_runtime'):
            assert not c.execute("SELECT has_table_privilege(%s, 'platform.notifications', 'SELECT')", (role,)).fetchone()[0]


def test_reminder_wording_and_phone_numbers():
    from cacu.billing.notify import nigerian_number, render
    subject, text = render('renewal_due', 'sms', {'plan': 'Oga', 'total_kobo': 645000, 'due_at': '2026-12-02T10:00:00Z', 'card': True}, 'Ada Provisions')
    assert subject == 'Your CACU renewal is due on 2 Dec 2026'
    assert text == 'CACU: Your Oga Plan renews on 2 Dec 2026. We will charge NGN 6,450 to your saved card.'
    _, email = render('card_declined', 'email', {'total_kobo': 161250}, 'Ada Provisions')
    assert email.startswith('Hello Ada Provisions,') and '₦1,612.50' in email and 'CACU Technologies Limited' in email
    assert [nigerian_number(n) for n in ('08031234567', '+234 803 123 4567', '2348031234567', '12345', None)] == \
        ['2348031234567', '2348031234567', '2348031234567', None, None]


def as_user(actor, sql, args=()):
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE authenticated')
        c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': str(actor)}),))
        return c.execute(sql, args).fetchone()[0]


def status(ident):
    with psycopg.connect(URL) as c:
        return c.execute('SELECT status, cancel_at_period_end FROM platform.subscriptions WHERE business_id=%s', (ident,)).fetchone()


def test_the_owner_cancels_and_access_continues_to_the_period_end_then_read_only(gateway):  # SUB-11
    ident, owner, editor = business()
    activate(ident, 'GROW', start='28 days', end='2 days')
    renewals()
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_user(editor, 'SELECT public.cancel_subscription(%s,true)', (ident,))
    assert as_user(owner, 'SELECT public.cancel_subscription(%s,true)', (ident,))['cancel_at_period_end'] is True
    assert open_renewal(ident) is None and renewals() == 0  # no renewal for a period that is not coming
    assert status(ident) == ('active', True) and count('SELECT platform.writes_allowed(%s)', ident) is True
    with psycopg.connect(URL) as c:
        c.execute("SELECT platform.end_periods(now()+interval '3 days')")
    assert status(ident) == ('cancelled', True) and count('SELECT platform.writes_allowed(%s)', ident) is False
    # SUB-12: choosing a plan reopens the same business.
    invoice = service.checkout(ident, owner, Checkout(request_key=uuid4(), plan='GROW'))
    gateway.pay(invoice)
    assert service.verify_return(ident, owner, Verification(reference=invoice['reference']))['outcome'] == 'activated'
    assert status(ident) == ('active', False)


def test_a_cancellation_can_be_taken_back_and_a_cancelled_trial_does_not_move_to_general(gateway):
    ident, owner, _ = business()
    as_user(owner, 'SELECT public.cancel_subscription(%s,true)', (ident,))
    as_user(owner, 'SELECT public.cancel_subscription(%s,false)', (ident,))
    assert status(ident) == ('trialing', False)
    as_user(owner, 'SELECT public.cancel_subscription(%s,true)', (ident,))
    with psycopg.connect(URL) as c:
        c.execute("SELECT set_config('platform.reason','test: trial elapsed',true)")
        c.execute("UPDATE platform.subscriptions SET current_period_start=now()-interval '14 days', current_period_end=now()-interval '1 minute' WHERE business_id=%s", (ident,))
        c.execute('SELECT platform.end_trials()')
    assert status(ident) == ('cancelled', True) and subscription(ident)[0] == 'GROW'
    with pytest.raises(psycopg.errors.RaiseException, match='BILLING_CANCEL_NEEDS_ACTIVE_PLAN'):
        as_user(owner, 'SELECT public.cancel_subscription(%s,false)', (ident,))
    with psycopg.connect(URL) as c:
        reasons = [r for (r,) in c.execute('SELECT reason FROM platform.subscription_changes WHERE business_id=%s ORDER BY id', (ident,))]
    assert 'Trial ended; subscription cancelled by the owner' in reasons


def staff(ident, n, role='editor'):
    people = [uuid4() for _ in range(n)]
    with psycopg.connect(URL) as c:
        for person in people:
            c.execute('INSERT INTO auth.users VALUES(%s,%s)', (person, f'{person.hex[:6]}@example.com'))
            c.execute('INSERT INTO memberships(business_id,user_id,role) VALUES(%s,%s,%s)', (ident, person, role))
    return people


def outlets(ident, n):
    with psycopg.connect(URL) as c:
        return [c.execute('INSERT INTO business_locations(business_id,name) VALUES(%s,%s) RETURNING id', (ident, f'Shop {i}')).fetchone()[0] for i in range(n)]


def active_members(ident):
    with psycopg.connect(URL) as c:
        return {u for (u,) in c.execute('SELECT user_id FROM memberships WHERE business_id=%s AND is_active', (ident,))}


def test_the_owner_chooses_who_stays_on_a_downgrade_and_the_rest_are_deactivated_not_deleted(gateway):  # SUB-06, TEST-206
    ident, owner, editor = business()
    activate(ident, 'TOP')
    extra = staff(ident, 3)
    shops = outlets(ident, 3)
    with psycopg.connect(URL) as c:
        c.execute("INSERT INTO business_invitations VALUES(%s,'invited',now()+interval '7 days')", (ident,))
    assert as_user(owner, 'SELECT public.downgrade_choices(%s)', (ident,))['plan'] is None  # nothing scheduled yet
    service.schedule(ident, owner, PlanChange(plan='BASE'))
    choices = as_user(owner, 'SELECT public.downgrade_choices(%s)', (ident,))
    assert (choices['plan_name'], choices['seats'], choices['outlets_limit'], len(choices['members']), len(choices['outlets'])) == ('General', 2, 1, 5, 3)
    assert [m['keep'] for m in choices['members'] if m['role'] == 'owner'] == [True]  # owners always stay
    with pytest.raises(psycopg.errors.RaiseException, match='PLAN_LIMIT users.max'):  # owner plus two is three seats
        as_user(owner, 'SELECT public.save_downgrade_choices(%s,%s,%s)', (ident, [extra[0], extra[1]], [shops[2]]))
    with pytest.raises(psycopg.errors.InvalidParameterValue, match='BILLING_KEEP_NOT_IN_BUSINESS'):
        as_user(owner, 'SELECT public.save_downgrade_choices(%s,%s,%s)', (ident, [uuid4()], []))
    saved = as_user(owner, 'SELECT public.save_downgrade_choices(%s,%s,%s)', (ident, [extra[2]], [shops[2]]))
    assert saved['chosen'] is True and [m['user_id'] for m in saved['members'] if m['keep']] == [str(owner), str(extra[2])]
    with psycopg.connect(URL) as c:
        c.execute("SELECT platform.end_periods(now()+interval '21 days')")
        assert c.execute('SELECT count(*) FROM memberships WHERE business_id=%s', (ident,)).fetchone()[0] == 5  # nothing deleted
        assert c.execute('SELECT id FROM business_locations WHERE business_id=%s AND is_active', (ident,)).fetchall() == [(shops[2],)]
        assert c.execute("SELECT status FROM business_invitations WHERE business_id=%s", (ident,)).fetchone()[0] == 'cancelled'
    assert active_members(ident) == {owner, extra[2]} and subscription(ident)[:2] == ('BASE', 'past_due')


def test_without_a_choice_the_earliest_added_stay_and_a_new_schedule_clears_an_old_choice(gateway):
    ident, owner, editor = business()  # the editor was added with the owner, before anyone else
    activate(ident, 'TOP')
    later = staff(ident, 2)
    service.schedule(ident, owner, PlanChange(plan='BASE'))
    as_user(owner, 'SELECT public.save_downgrade_choices(%s,%s,%s)', (ident, [later[1]], []))
    service.schedule(ident, owner, PlanChange(plan='TOP'))  # cancelled
    service.schedule(ident, owner, PlanChange(plan='BASE'))
    assert as_user(owner, 'SELECT public.downgrade_choices(%s)', (ident,))['chosen'] is False
    with psycopg.connect(URL) as c:
        c.execute("SELECT platform.end_periods(now()+interval '21 days')")
    assert active_members(ident) == {owner, editor}


def test_a_trial_ending_on_general_applies_the_choice_too_and_only_managers_see_it(gateway):
    ident, owner, editor = business()
    extra = staff(ident, 2)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_user(editor, 'SELECT public.downgrade_choices(%s)', (ident,))
    assert as_user(owner, 'SELECT public.downgrade_choices(%s)', (ident,))['plan'] == 'BASE'  # Oga trial ends on General
    as_user(owner, 'SELECT public.save_downgrade_choices(%s,%s,%s)', (ident, [extra[1]], []))
    with psycopg.connect(URL) as c:
        c.execute("SELECT set_config('platform.reason','test: trial elapsed',true)")
        c.execute("UPDATE platform.subscriptions SET current_period_start=now()-interval '14 days', current_period_end=now()-interval '1 minute' WHERE business_id=%s", (ident,))
        c.execute('SELECT platform.end_trials()')
    assert active_members(ident) == {owner, extra[1]} and status(ident) == ('incomplete', False)
