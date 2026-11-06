"""Bookings, part 1 (Doc 10 services, bookings and jobs rules; Doc 07 M-13): service staff with their services, hours and
time off; bookings that never overlap for a staff member and stay inside their hours; the booking states; and who may
book, change and manage staff. Bookings are written through the Data API, so these run as the signed-in member."""
from datetime import date, datetime, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo
import psycopg
import pytest
from test_corrections_postgres import live, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_pos_checkout_postgres import as_template
from test_pos_refunds_postgres import as_member

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
LAGOS = ZoneInfo('Africa/Lagos')


def monday() -> date:
    today = datetime.now(LAGOS).date()
    return today + timedelta(days=(7 - today.weekday()) or 7)


def at(hour, minute=0, day=None):
    return datetime.combine(day or monday(), datetime.min.time(), LAGOS).replace(hour=hour, minute=minute)


@pytest.fixture
def salon(live):
    """Ada does braids (45 minutes) on Mondays 09:00 to 17:00; Bisi does nothing yet."""
    braids, nails, customer = uuid4(), uuid4(), uuid4()
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL session_replication_role = replica')  # test setup: skip the catalogue's posting guard
        c.execute("""INSERT INTO catalog_items(id,business_id,name,item_type,unit_price,is_active,duration) VALUES
                     (%s,%s,'Braids','SERVICE',15000,true,45),(%s,%s,'Nails','SERVICE',5000,true,NULL)""",
                  (braids, live.business, nails, live.business))
        c.execute("INSERT INTO customers(id,business_id,name) VALUES(%s,%s,'Funmi')", (customer, live.business))
    ada = as_member(live, 'owner', 'INSERT INTO service_staff(business_id,name) VALUES(%s,%s) RETURNING id', live.business, 'Ada')[0][0]
    bisi = as_member(live, 'owner', 'INSERT INTO service_staff(business_id,name) VALUES(%s,%s) RETURNING id', live.business, 'Bisi')[0][0]
    as_member(live, 'owner', 'INSERT INTO service_staff_services(business_id,staff_id,service_id) VALUES(%s,%s,%s),(%s,%s,%s) RETURNING staff_id',
              live.business, ada, braids, live.business, ada, nails)
    as_member(live, 'owner', "INSERT INTO service_staff_hours(business_id,staff_id,weekday,starts,ends) VALUES(%s,%s,1,'09:00','13:00'),(%s,%s,1,'14:00','17:00') RETURNING weekday",
              live.business, ada, live.business, ada)
    live.salon = {'braids': braids, 'nails': nails, 'customer': customer, 'ada': ada, 'bisi': bisi}
    return live


def book(live, who, start, staff='ada', service='braids', **kw):
    s = live.salon
    columns = {'business_id': live.business, 'staff_id': s[staff], 'service_id': s[service], 'scheduled_at': start,
               'title': '', 'customer_name': 'Walk-in', **kw}
    names = ','.join(columns)
    return as_member(live, who, f'INSERT INTO appointments({names}) VALUES({",".join(["%s"] * len(columns))}) RETURNING id,status,duration_minutes,ends_at,title,created_by',
                     *columns.values())[0]


def change(live, who, booking, sql, *args):
    return as_member(live, who, f'UPDATE appointments SET {sql} WHERE id=%s RETURNING status', *args, booking)


def test_a_booking_takes_the_services_duration_and_never_overlaps_or_leaves_working_hours(salon):
    live = salon
    as_template(live, 'editor', 'cashier')
    first = book(live, 'editor', at(10), status='completed')
    assert first[1:5] == ('confirmed', 45, at(10, 45), 'Braids') and first[5] == live.people['editor']
    with pytest.raises(psycopg.errors.ExclusionViolation, match='BOOKING_OVERLAP'):
        book(live, 'owner', at(10, 30))
    assert book(live, 'owner', at(10, 45))[1] == 'confirmed'  # back to back is fine
    assert book(live, 'owner', at(11, 30), service='nails')[2] == 60  # a service with no duration takes an hour
    with pytest.raises(psycopg.errors.CheckViolation, match='OUTSIDE_WORKING_HOURS'):
        book(live, 'owner', at(12, 30))  # runs into the lunch break
    with pytest.raises(psycopg.errors.CheckViolation, match='OUTSIDE_WORKING_HOURS'):
        book(live, 'owner', at(10, day=monday() + timedelta(days=6)))  # Sunday
    as_member(live, 'owner', 'INSERT INTO service_staff_time_off(business_id,staff_id,starts_at,ends_at,reason) VALUES(%s,%s,%s,%s,%s) RETURNING id',
              live.business, live.salon['ada'], at(15), at(17), 'Hospital visit')
    with pytest.raises(psycopg.errors.CheckViolation, match='STAFF_TIME_OFF'):
        book(live, 'owner', at(15, 30))
    with pytest.raises(psycopg.errors.CheckViolation, match='STAFF_CANNOT_DELIVER'):
        book(live, 'owner', at(10), staff='bisi')  # Bisi has no hours set, but does not do braids
    with pytest.raises(psycopg.errors.CheckViolation, match='CUSTOMER_REQUIRED'):
        book(live, 'owner', at(14), customer_name='')
    assert book(live, 'owner', at(14), customer_name=None, customer_id=live.salon['customer'])[1] == 'confirmed'
    with pytest.raises(psycopg.errors.CheckViolation, match='BOOKING_IN_PAST'):
        book(live, 'owner', datetime.now(LAGOS) - timedelta(hours=2))


def test_bookings_move_through_their_states_and_are_never_deleted(salon):
    live = salon
    as_template(live, 'editor', 'cashier')
    booking = book(live, 'editor', at(9))[0]
    assert change(live, 'editor', booking, "status='checked_in'") == []  # a cashier books but cannot run bookings
    with pytest.raises(psycopg.errors.CheckViolation, match='NO_SHOW_TOO_EARLY'):
        change(live, 'owner', booking, "status='no_show'")
    with pytest.raises(psycopg.errors.CheckViolation, match='BOOKING_STATE_INVALID'):
        change(live, 'owner', booking, "status='completed'")
    other = book(live, 'owner', at(11))[0]
    with pytest.raises(psycopg.errors.ExclusionViolation, match='BOOKING_OVERLAP'):
        change(live, 'owner', booking, 'scheduled_at=%s', at(11, 15))
    assert change(live, 'owner', booking, 'scheduled_at=%s', at(9, 15)) == [('confirmed',)]  # rescheduled
    assert change(live, 'owner', booking, "status='checked_in'") == [('checked_in',)]
    with pytest.raises(psycopg.errors.CheckViolation, match='BOOKING_NOT_RESCHEDULABLE'):
        change(live, 'owner', booking, 'scheduled_at=%s', at(9, 30))
    assert change(live, 'owner', booking, "status='completed'") == [('completed',)]
    with pytest.raises(psycopg.errors.CheckViolation, match='CANCEL_REASON_REQUIRED'):
        change(live, 'owner', other, "status='cancelled'")
    assert change(live, 'owner', other, "status='cancelled',cancel_reason=%s", 'Customer travelled') == [('cancelled',)]
    assert book(live, 'owner', at(11))[1] == 'confirmed'  # a cancelled booking frees its slot
    history = as_member(live, 'owner', 'SELECT to_status,note FROM appointment_events WHERE appointment_id IN (%s,%s) ORDER BY id', booking, other)
    assert history == [('confirmed', None), ('confirmed', None), ('confirmed', None), ('checked_in', None), ('completed', None),
                       ('cancelled', 'Customer travelled')]
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_member(live, 'owner', 'DELETE FROM appointments WHERE id=%s RETURNING id', booking)
    # A customer who never came is marked once the start time has passed.
    past = uuid4()
    with psycopg.connect(URL) as c:
        c.execute("SET LOCAL session_replication_role = replica")
        c.execute("""INSERT INTO appointments(id,business_id,staff_id,service_id,scheduled_at,ends_at,duration_minutes,title,status,customer_name)
                     VALUES(%s,%s,%s,%s,now()-interval '2 hours',now()-interval '75 minutes',45,'Braids','confirmed','Walk-in')""",
                  (past, live.business, live.salon['ada'], live.salon['braids']))
    assert change(live, 'owner', past, "status='no_show'") == [('no_show',)]


def test_staff_are_managed_in_settings_and_bookings_are_seen_by_people_with_services(salon):
    live = salon
    as_template(live, 'editor', 'cashier')
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_member(live, 'editor', 'INSERT INTO service_staff(business_id,name) VALUES(%s,%s) RETURNING id', live.business, 'Chika')
    assert [r[0] for r in as_member(live, 'editor', 'SELECT name FROM service_staff ORDER BY name')] == ['Ada', 'Bisi']
    with pytest.raises(psycopg.errors.UniqueViolation):
        as_member(live, 'owner', 'INSERT INTO service_staff(business_id,name) VALUES(%s,%s) RETURNING id', live.business, ' ada ')
    with pytest.raises(psycopg.errors.CheckViolation, match='SERVICE_UNAVAILABLE'):
        as_member(live, 'owner', 'INSERT INTO service_staff_services(business_id,staff_id,service_id) VALUES(%s,%s,%s) RETURNING staff_id',
                  live.business, live.salon['bisi'], live.items['Beans'])
    booking = book(live, 'owner', at(16))[0]
    as_template(live, 'viewer', 'auditor')
    assert [r[0] for r in as_member(live, 'viewer', 'SELECT id FROM appointments')] == [booking]
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        book(live, 'viewer', at(9))
    as_member(live, 'owner', 'UPDATE service_staff SET is_active=false WHERE id=%s RETURNING id', live.salon['ada'])
    with pytest.raises(psycopg.errors.CheckViolation, match='STAFF_CANNOT_DELIVER'):
        book(live, 'owner', at(9))  # a staff member who left cannot be booked
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_member(live, 'owner', 'DELETE FROM service_staff WHERE id=%s RETURNING id', live.salon['ada'])
