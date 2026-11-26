"""Funding readiness on the books (Doc 15 FR-180, FRA-001/003/004/005/009): off until gate G5, eligibility after six
full months with nothing left waiting, one assessment a day recorded with its model version, models never edited."""
from datetime import timedelta
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.readiness import NOTICE, assess, overview
from test_corrections_postgres import live, call, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_activation_postgres import TODAY

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


def switch(on):
    with psycopg.connect(URL) as c:
        c.execute('UPDATE accounting.funding_switch SET enabled=%s, changed_at=now()', (on,))


def started(live, months_ago):
    """Moves the start of the books back, as if the business had used CACU for that long."""
    first = (TODAY.replace(day=1) - timedelta(days=1)).replace(day=1)
    for _ in range(months_ago - 1):
        first = (first - timedelta(days=1)).replace(day=1)
    with psycopg.connect(URL) as c:
        c.execute('UPDATE accounting.business_map SET cutover_date=%s WHERE business_id=%s', (first, live.business))
    return first


def test_off_until_cacu_switches_it_on(live):
    switch(False)
    result = call(live, 'viewer', lambda s, a: overview(s))
    assert (result['available'], result['message'], result['eligibility'], result['notice']) == (False, 'Funding readiness is not available yet.', None, NOTICE)
    with pytest.raises(HTTPException) as refused:
        call(live, 'owner', lambda s, a: assess(s, a))
    assert refused.value.status_code == 409
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT count(*) FROM accounting.funding_assessment').fetchone()[0] == 0


def test_new_books_are_told_what_is_missing_and_when_they_can_qualify(live):
    switch(True)
    result = call(live, 'viewer', lambda s, a: overview(s))
    assert result['available'] is True and result['level'] == 'lender_pack'  # not yet billed: everything is included
    eligibility = result['eligibility']
    assert eligibility['eligible'] is False and [m['key'] for m in eligibility['missing']] == ['history']
    first_full = TODAY if TODAY.day == 1 else (TODAY.replace(day=28) + timedelta(days=4)).replace(day=1)
    month = first_full
    for _ in range(6):
        month = (month.replace(day=28) + timedelta(days=4)).replace(day=1)
    assert eligibility['earliest_date'] == month.isoformat()
    with pytest.raises(HTTPException, match='6 full months'):
        call(live, 'owner', lambda s, a: assess(s, a))


def test_an_assessment_explains_every_point_is_kept_once_a_day_and_models_never_change(live):
    switch(True)
    first = started(live, 8)
    assert call(live, 'viewer', lambda s, a: overview(s))['eligibility'] == {'eligible': True, 'missing': [], 'earliest_date': None}
    made = call(live, 'viewer', lambda s, a: assess(s, a))
    assert made['model_version'] == 'fra-1' and made['notice'] == NOTICE and 0 <= made['score'] <= 100
    assert made['period'] == {'start_date': first.isoformat(), 'end_date': (TODAY.replace(day=1) - timedelta(days=1)).isoformat(), 'months': 8}
    assert [d['key'] for d in made['dimensions']] == ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7']
    assert made['based_on'] == sum(1 for d in made['dimensions'] if d['score'] is not None)
    d1 = made['dimensions'][0]
    assert d1['measures'][0]['value'] == '0.00'  # everything in these books is dated today, after the period
    assert made['band'] in {'strong', 'developing', 'early', 'not_yet_ready'} and made['label'] == 'From your CACU books, not reviewed'

    again = call(live, 'owner', lambda s, a: assess(s, a))
    assert again['id'] == made['id']  # at most once a day on request (FRA-003)
    seen = call(live, 'viewer', lambda s, a: overview(s))
    assert seen['assessed_today'] is True and seen['latest']['id'] == made['id']
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT count(*), min(model_version), min(kind) FROM accounting.funding_assessment').fetchone() == (1, 'fra-1', 'request')
        with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
            c.execute("UPDATE accounting.funding_model SET definition=definition || '{\"period_months\": 6}' WHERE version='fra-1'")
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE cacu_runtime')
        for sql in ('UPDATE accounting.funding_assessment SET score=100', 'DELETE FROM accounting.funding_assessment',
                    'UPDATE accounting.funding_switch SET enabled=false'):
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                with c.transaction():
                    c.execute(sql)


def test_waiting_items_older_than_30_days_block_an_assessment(live):
    from cacu.accounting.workflows import sale_create
    from test_pos_checkout_postgres import sale
    switch(True)
    started(live, 8)
    call(live, 'owner', lambda s, a: sale_create(s, a, sale(live, method='Transfer')))  # waits for the bank to confirm
    assert call(live, 'viewer', lambda s, a: overview(s))['eligibility']['eligible'] is True  # waiting, but not for 30 days yet
    # A waiting transfer cannot be edited (its trigger refuses), so copy it as one recorded 45 days ago.
    with psycopg.connect(URL) as c:
        copied = c.execute("""INSERT INTO accounting.pending_transfer(business_id, id, source_type, amount, entry_date, customer_id, created_by)
            SELECT business_id, gen_random_uuid(), source_type, amount, %s, customer_id, created_by FROM accounting.pending_transfer
            WHERE business_id=%s AND status='pending'""", (TODAY - timedelta(days=45), live.business)).rowcount
    assert copied == 1
    eligibility = call(live, 'viewer', lambda s, a: overview(s))['eligibility']
    assert eligibility['eligible'] is False
    assert eligibility['missing'] == [{'key': 'transfers', 'message': 'Confirm or clear the 1 transfer waiting more than 30 days.'}]
    with pytest.raises(HTTPException, match='Confirm or clear'):
        call(live, 'owner', lambda s, a: assess(s, a))
