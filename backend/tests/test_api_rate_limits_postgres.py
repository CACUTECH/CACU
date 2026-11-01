"""Write rate limits for the accounting API (API-012, SEC-026): per user and per business, 429 with Retry-After."""
import json
from uuid import uuid4
import psycopg
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.pool import NullPool
from test_library_postgres import database, DSN

pytestmark = pytest.mark.skipif(not DSN, reason='Disposable PostgreSQL required')


def slot(business, actor):
    with psycopg.connect(DSN) as c:
        c.execute('SET LOCAL ROLE cacu_runtime')
        c.execute("SELECT set_config('request.jwt.claims',%s,true),set_config('cacu.business_id',%s,true)", (json.dumps({'sub': str(actor)}), str(business)))
        return c.execute('SELECT accounting.take_write_slot(%s)', (str(business),)).fetchone()[0]


def member(business, role='editor'):
    person = uuid4()
    with psycopg.connect(DSN) as c:
        c.execute('INSERT INTO public.memberships(business_id,user_id,role) VALUES(%s,%s,%s)', (str(business), str(person), role))
    return person


def test_sixty_writes_a_minute_per_person_then_a_wait(database):
    business, owner = database[1], database[2]
    assert [slot(business, owner) for _ in range(60)] == [0] * 60
    wait = slot(business, owner)
    assert 1 <= wait <= 60
    assert slot(business, member(business)) == 0  # another person still has their own allowance


def test_three_hundred_writes_a_minute_per_business(database):
    business = database[1]
    people = [member(business) for _ in range(5)]
    assert all(slot(business, p) == 0 for p in people for _ in range(60))
    assert slot(business, member(business)) > 0  # the business allowance is used up for everyone


def test_viewers_and_outsiders_do_not_use_up_a_business_allowance(database):
    business = database[1]
    viewer, outsider = member(business, 'viewer'), uuid4()
    for _ in range(70):
        assert slot(business, viewer) == 0 and slot(business, outsider) == 0
    with psycopg.connect(DSN) as c:
        assert c.execute("SELECT coalesce(sum(requests),0) FROM accounting.request_window WHERE scope='business' AND subject=%s", (business,)).fetchone()[0] == 0


def test_scope_must_match_the_business_in_the_request(database):
    with psycopg.connect(DSN) as c:
        c.execute('SET LOCAL ROLE cacu_runtime')
        c.execute("SELECT set_config('request.jwt.claims',%s,true),set_config('cacu.business_id',%s,true)", (json.dumps({'sub': str(database[2])}), str(uuid4())))
        with pytest.raises(psycopg.Error, match='Invalid rate limit scope'):
            c.execute('SELECT accounting.take_write_slot(%s)', (str(database[1]),))


def test_browser_roles_cannot_read_or_take_slots(database):
    with psycopg.connect(DSN) as c:
        c.execute('SET LOCAL ROLE authenticated')
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            c.execute('SELECT accounting.take_write_slot(%s)', (str(database[1]),))


def test_api_answers_429_with_retry_after_and_writes_nothing(database, monkeypatch):
    from fastapi.testclient import TestClient
    import app as api
    import cacu.accounting.session as sessions
    business, owner, accounts, year = database[1], database[2], database[4], database[6]

    def test_engine(*args, **kwargs):
        engine = create_engine(DSN.replace('postgresql://', 'postgresql+psycopg://'), poolclass=NullPool)

        @event.listens_for(engine, 'connect')
        def role(connection, record):
            connection.autocommit = True
            with connection.cursor() as cursor:
                cursor.execute('SET ROLE cacu_runtime')
            connection.autocommit = False
        return engine
    monkeypatch.setenv('CACU_DATABASE_URL', DSN)
    monkeypatch.setattr(sessions, 'create_engine', test_engine)
    api.app.dependency_overrides[api.current_user] = lambda: owner
    journal = lambda: {'request_key': str(uuid4()), 'date': f'{year}-02-10', 'memo': 'Owner capital', 'lines': [
        {'account_id': str(accounts['cash'][0]), 'debit': '10.00', 'credit': '0.00', 'description': ''},
        {'account_id': str(accounts['equity'][0]), 'debit': '0.00', 'credit': '10.00', 'description': ''}]}
    try:
        client = TestClient(api.app)
        assert client.post(f'/api/v1/businesses/{business}/journals', json=journal()).status_code == 200
        for _ in range(59):
            slot(business, owner)
        refused = client.post(f'/api/v1/businesses/{business}/journals', json=journal())
        assert refused.status_code == 429 and 1 <= int(refused.headers['Retry-After']) <= 60
        assert refused.json()['detail'].startswith('Too many changes in a short time')
        with psycopg.connect(DSN) as c:
            assert c.execute("SELECT count(*) FROM accounting.document_map WHERE business_id=%s AND source_type='adjustment'", (business,)).fetchone() == (1,)
        assert client.get(f'/api/v1/businesses/{business}/collection-accounts').status_code == 200  # reading is not limited
    finally:
        api.app.dependency_overrides.pop(api.current_user, None)
