"""Customer notifications, part 1 (Doc 10 E20; owner decisions of 7 November 2026): a sale's receipt goes to the customer by
email or text and as a public link. Texts come from a monthly allowance by plan; past it the receipt goes by email only.
The link shows the receipt, never the customer's details, and can be revoked. The operator sends what is queued and
keeps the customer's address no longer than it needs."""
import json
from uuid import uuid4
import psycopg
import pytest
from cacu.billing import notify, service
from test_corrections_postgres import live, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_pos_refunds_postgres import sold
from test_pos_shifts_postgres import on_plan
from test_platform_billing_postgres import FakeProviders

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


def as_person(live, who, sql, *args):
    """Runs sql through the Data API path: as a signed-in person (or anonymously when who is None)."""
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE ' + ('anon' if who is None else 'authenticated'))
        sub = None if who is None else str(live.people.get(who, who))
        c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': sub} if sub else {}),))
        return c.execute(sql, args).fetchone()[0]


def share(live, sale_id, who='owner', key=None, email=None, phone=None):
    return as_person(live, who, 'SELECT public.share_receipt(%s,%s,%s,%s,%s)', live.business, sale_id, key or uuid4(), email, phone)


def outbox(live):
    with psycopg.connect(URL) as c:
        return c.execute('SELECT kind,channel,recipient,shown_to,status FROM platform.customer_messages WHERE business_id=%s ORDER BY id',
                         (live.business,)).fetchall()


@pytest.fixture
def runtime(monkeypatch):
    def connect():
        connection = psycopg.connect(URL, autocommit=True)
        connection.execute('SET ROLE cacu_runtime')
        return connection
    monkeypatch.setattr(service, 'connect', connect)


def test_a_receipt_goes_by_email_text_and_link_and_the_link_shows_only_the_receipt(live, runtime, monkeypatch):
    sale_id = sold(live, lines=(('Beans', 2, '0'),))
    key = uuid4()
    sent = share(live, sale_id, key=key, email=' Ada@Example.com ', phone='0803 123 4567')
    assert (sent['email'], sent['text'], sent['texts']['used']) == ('queued', 'queued', 1)
    assert share(live, sale_id, key=key, email='ada@example.com', phone='08031234567')['email'] == 'already_queued'  # a retry
    assert outbox(live) == [('receipt', 'sms', '2348031234567', '0803***4567', 'queued'), ('receipt', 'email', 'ada@example.com', 'a***@example.com', 'queued')]

    shown = as_person(live, None, 'SELECT public.public_receipt(%s)', sent['token'])
    assert (shown['total'], [i['quantity'] for i in shown['items']], shown['business']['name']) == (3000, [2], shown['business']['name'])
    assert 'ada' not in json.dumps(shown).lower() and '0803' not in json.dumps(shown)
    assert as_person(live, None, 'SELECT public.public_receipt(%s)', 'f' * 64) is None
    assert as_person(live, 'owner', 'SELECT public.revoke_receipt_link(%s,%s)', live.business, sale_id) is True
    assert as_person(live, None, 'SELECT public.public_receipt(%s)', sent['token']) is None
    again = share(live, sale_id)
    assert again['token'] != sent['token'] and again['email'] is None  # a new link; nothing sent without an address

    for bad, error in (({'email': 'not-an-email'}, 'EMAIL_INVALID'), ({'phone': '12345'}, 'PHONE_INVALID')):
        with pytest.raises(psycopg.Error, match=error):
            share(live, sale_id, **bad)
    with pytest.raises(psycopg.Error, match='PERMISSION_DENIED'):
        share(live, sale_id, who=str(uuid4()), email='ada@example.com')
    with pytest.raises(psycopg.Error, match='SALE_NOT_FOUND'):
        share(live, uuid4(), email='ada@example.com')

    providers = FakeProviders(monkeypatch)
    assert notify.send_customer_due() == {'channels': ['email', 'sms'], 'claimed': 2, 'sent': 2, 'failed': 0, 'skipped': 0}
    (sms_url, sms), (email_url, email) = providers.sent
    assert sms['json']['to'] == '2348031234567' and f"https://app.example.com/r/{sent['token']}" in sms['json']['sms'] and 'NGN 3,000' in sms['json']['sms']
    assert email['json']['to'] == ['ada@example.com'] and email['json']['subject'].startswith('Your receipt from ')
    assert '₦3,000' in email['json']['text'] and f"/r/{sent['token']}" in email['json']['text']
    assert [r[4] for r in outbox(live)] == ['sent', 'sent']
    with psycopg.connect(URL) as c:
        c.execute("UPDATE platform.customer_messages SET created_at=now()-interval '31 days' WHERE business_id=%s", (live.business,))
    assert notify.send_customer_due()['claimed'] == 0
    assert [(r[2], r[3]) for r in outbox(live)] == [(None, '0803***4567'), (None, 'a***@example.com')]  # addresses cleared, masks kept


def test_texts_stop_at_the_plans_allowance_and_the_receipt_falls_back_to_email(live):
    on_plan(live, 'BASE')
    sale_id = sold(live)
    with psycopg.connect(URL) as c:
        for n in range(20):
            c.execute("""INSERT INTO platform.customer_messages(business_id,kind,channel,recipient,shown_to,dedupe_key)
                         VALUES(%s,'receipt','sms','2348031234567','0803***4567',%s)""", (live.business, f'filler:{n}'))
    sent = share(live, sale_id, email='ada@example.com', phone='08031234567')
    assert (sent['text'], sent['email'], sent['texts']['limit'], sent['texts']['remaining']) == ('allowance_used', 'queued', 20, 0)
    on_plan(live, 'GROW')
    upgraded = share(live, sale_id, phone='08031234567')  # Oga allows 200 a month
    assert (upgraded['text'], upgraded['texts']['limit'], upgraded['texts']['used']) == ('queued', 200, 21)


def test_the_notifications_page_shows_masked_history_and_only_settings_editors_change_reminders(live):
    sale_id = sold(live)
    share(live, sale_id, email='ada@example.com')
    seen = as_person(live, 'viewer', 'SELECT public.notification_overview(%s)', live.business)
    assert (seen['invoice_reminders'], seen['booking_reminders'], seen['can_edit']) == (False, False, False)
    assert [(m['kind'], m['to']) for m in seen['recent']] == [('receipt', 'a***@example.com')]
    with pytest.raises(psycopg.Error, match='PERMISSION_DENIED'):
        as_person(live, 'viewer', 'SELECT public.save_notification_settings(%s,true,true)', live.business)
    saved = as_person(live, 'owner', 'SELECT public.save_notification_settings(%s,true,false)', live.business)
    assert (saved['invoice_reminders'], saved['booking_reminders'], saved['can_edit']) == (True, False, True)
    with pytest.raises(psycopg.Error, match='PERMISSION_DENIED'):
        as_person(live, str(uuid4()), 'SELECT public.notification_overview(%s)', live.business)
