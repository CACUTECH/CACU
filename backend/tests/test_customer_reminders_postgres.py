"""Customer notifications, parts 2 and 3 (Doc 10 E20; owner decisions of 7 November 2026): overdue invoice reminders the
day before, on the due date and 7 days after while something is owed, when the business turns them on, plus a reminder
staff send by hand; booking confirmations and a reminder about a day before. Texts first, email when texts run out."""
from datetime import datetime, timedelta
from decimal import Decimal
from uuid import uuid4
from zoneinfo import ZoneInfo
import psycopg
import pytest
from cacu.accounting.workflows import InvoiceCreate, ReceiptCreate, invoice_create, receipt_create
from cacu.billing.notify import render_customer
from test_corrections_postgres import live, call, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_activation_postgres import TODAY
from test_pos_shifts_postgres import on_plan
from test_bookings_postgres import at, book, monday, salon  # noqa: F401
from test_customer_messages_postgres import as_person

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
LAGOS = ZoneInfo('Africa/Lagos')


def settings(live, invoices=False, bookings=False):
    as_person(live, 'owner', 'SELECT public.save_notification_settings(%s,%s,%s)', live.business, invoices, bookings)


def contact(live, customer, phone=None, email=None):
    with psycopg.connect(URL) as c:
        c.execute('ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone_number text, ADD COLUMN IF NOT EXISTS email text')  # as in production
        c.execute('UPDATE customers SET phone_number=%s,email=%s WHERE id=%s', (phone, email, customer))


def invoice(live, due, amount='65000'):
    data = InvoiceCreate(request_key=uuid4(), customer_id=live.ids['ada'], invoice_number=f'INV-{uuid4().hex[:6]}', entry_date=TODAY, due_date=due,
                         items=[{'catalog_item_id': live.items['Rice'], 'quantity': 1, 'unit_price': amount}])
    call(live, 'owner', lambda s, a: invoice_create(s, a, data))
    return data.request_key


def pay(live, invoice_id, amount):
    call(live, 'owner', lambda s, a: receipt_create(s, a, ReceiptCreate(request_key=uuid4(), invoice_id=invoice_id, amount=amount, entry_date=TODAY, method='Cash')))


def run(when):
    with psycopg.connect(URL) as c:
        return c.execute('SELECT platform.queue_customer_reminders(%s)', (when,)).fetchone()[0]


def queued(live, kind):
    with psycopg.connect(URL) as c:
        return c.execute('SELECT channel,recipient,details,source_id FROM platform.customer_messages WHERE business_id=%s AND kind=%s ORDER BY id',
                         (live.business, kind)).fetchall()


def lagos(day, hour):
    return datetime.combine(day, datetime.min.time(), LAGOS).replace(hour=hour)


def test_unpaid_invoices_are_reminded_before_on_and_after_the_due_date_once_and_only_when_turned_on(live):
    contact(live, live.ids['ada'], phone='0803 123 4567', email='ada@example.com')
    soon = invoice(live, TODAY + timedelta(days=1))
    pay(live, soon, '15000')
    late = invoice(live, TODAY - timedelta(days=7))
    assert run(lagos(TODAY, 10)) == 0  # off by default
    settings(live, invoices=True)
    assert run(lagos(TODAY, 7)) == 0  # not before 9:00 in Lagos
    assert run(lagos(TODAY, 10)) >= 2  # also any opening balance still owed that falls due on one of these dates
    assert run(lagos(TODAY, 11)) == 0  # once per stage
    sent = {d['stage']: (channel, to, Decimal(str(d['outstanding']))) for channel, to, d, source in queued(live, 'invoice_reminder') if source in (soon, late)}
    assert sent == {'before': ('sms', '2348031234567', Decimal('50000')), 'after': ('sms', '2348031234567', Decimal('65000'))}
    pay(live, soon, '50000')
    run(lagos(TODAY + timedelta(days=1), 10))
    assert [d['stage'] for _, _, d, source in queued(live, 'invoice_reminder') if source == soon] == ['before']  # paid: none on the due date

    subject, text = render_customer('invoice_reminder', 'sms', next(d for _, _, d, source in queued(live, 'invoice_reminder') if source == soon), 'Ada Provisions')
    assert text.startswith('Ada Provisions: Invoice INV-') and 'NGN 50,000' in text and 'is due on' in text


def test_staff_can_send_a_reminder_and_texts_give_way_to_email_past_the_allowance(live):
    contact(live, live.ids['ada'], phone='08031234567', email='ada@example.com')
    owed = invoice(live, TODAY + timedelta(days=10))
    sent = as_person(live, 'editor', 'SELECT public.send_invoice_reminder(%s,%s,%s)', live.business, owed, uuid4())
    assert sent['result'] == 'sms'
    with pytest.raises(psycopg.Error, match='PERMISSION_DENIED'):
        as_person(live, 'viewer', 'SELECT public.send_invoice_reminder(%s,%s,%s)', live.business, owed, uuid4())
    on_plan(live, 'BASE')
    with psycopg.connect(URL) as c:
        for n in range(19):
            c.execute("""INSERT INTO platform.customer_messages(business_id,kind,channel,recipient,shown_to,dedupe_key)
                         VALUES(%s,'receipt','sms','2348031234567','0803***4567',%s)""", (live.business, f'filler:{n}'))
    assert as_person(live, 'editor', 'SELECT public.send_invoice_reminder(%s,%s,%s)', live.business, owed, uuid4())['result'] == 'email'
    contact(live, live.ids['ada'])
    assert as_person(live, 'editor', 'SELECT public.send_invoice_reminder(%s,%s,%s)', live.business, owed, uuid4())['result'] == 'no_contact'
    pay(live, owed, '65000')
    assert as_person(live, 'editor', 'SELECT public.send_invoice_reminder(%s,%s,%s)', live.business, owed, uuid4())['result'] == 'not_due'  # paid


def test_bookings_get_a_confirmation_and_a_reminder_the_day_before_when_turned_on(salon):
    live = salon
    later = monday() + timedelta(days=7)
    book(live, 'owner', at(10, day=later), customer_phone='08031234567')
    assert queued(live, 'booking_confirmation') == []  # booking messages are off
    settings(live, bookings=True)
    booking = book(live, 'owner', at(11, day=later), customer_phone='08031234567')[0]
    [(channel, to, details, _)] = queued(live, 'booking_confirmation')
    assert (channel, to, details['service']) == ('sms', '2348031234567', 'Braids')
    assert render_customer('booking_confirmation', 'sms', details, 'Ada Salon')[1].startswith('Ada Salon: Your booking for Braids is confirmed for Mon ')
    day_before = at(11, day=later) - timedelta(hours=24)
    assert run(day_before - timedelta(hours=4)) == 0  # more than 26 hours ahead
    assert run(day_before) == 2  # both bookings: the earlier one was made before booking messages were on
    assert run(day_before + timedelta(hours=1)) == 0
    assert {d['service'] for _, _, d, _ in queued(live, 'booking_reminder')} == {'Braids'}
    on_plan(live, 'BASE')  # booking messages come with Oga and Chairman
    book(live, 'owner', at(14, day=later), customer_phone='08031234567')
    assert len(queued(live, 'booking_confirmation')) == 1
    with psycopg.connect(URL) as c:
        assert c.execute("SELECT count(*) FROM platform.customer_messages WHERE source_id=%s AND kind='booking_reminder'", (booking,)).fetchone()[0] == 1
