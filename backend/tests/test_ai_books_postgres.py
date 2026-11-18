"""AI on the books (Doc 15, AI-009/011/012): off until CACU and the owner both turn it on, the plan allowance and shared
limits still apply, only metadata is kept, and the daily token ceiling turns it off for everyone."""
from pathlib import Path
from uuid import uuid4
import psycopg
import pytest
from test_ai_chat_postgres import URL, MODEL, FINGERPRINT, database, enable, member, rpc  # noqa: F401  (fixture)

pytestmark = pytest.mark.skipif(not URL, reason='Dedicated AI test database required')
MIGRATION = Path(__file__).resolve().parents[2] / 'supabase/migrations/20261127090000_ai_books.sql'


@pytest.fixture(autouse=True)
def books(database):
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(MIGRATION.read_text(encoding='utf-8'))
    yield


def cacu_books(on=True, **settings):
    with psycopg.connect(URL) as c:
        c.execute('UPDATE ai_private.settings SET books_enabled=%s', (on,))
        for key, value in settings.items():
            assert key in {'books_daily_tokens', 'actor_per_day'}
            c.execute(psycopg.sql.SQL('UPDATE ai_private.settings SET {}=%s').format(psycopg.sql.Identifier(key)), (value,))


def reserve(actor, business, key=None):
    return rpc(actor, 'reserve_ai_books', (business, key or uuid4(), FINGERPRINT, MODEL))


def record(actor, business, key, tokens=(1000, 200), check='passed'):
    return rpc(actor, 'record_ai_books', (business, key, ['profit_summary'], tokens[0], tokens[1], 1500, check, 'completed'))


def test_books_answers_need_cacu_and_the_owner_and_only_the_owner_may_switch():
    owner, business = member()
    admin, _ = member(business, 'admin')
    enable()
    assert rpc(owner, 'get_ai_books_status', (business,)) == {'available': False, 'paused': False, 'on': False, 'may_change': True}
    with pytest.raises(psycopg.errors.RaiseException, match='AI_BOOKS_OFF'):
        reserve(owner, business)
    cacu_books()
    with pytest.raises(psycopg.errors.RaiseException, match='AI_BOOKS_OFF'):
        reserve(owner, business)  # CACU has it on; this owner has not
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match='AI_OWNER_ONLY'):
        rpc(admin, 'set_ai_books', (business, True))
    assert rpc(owner, 'set_ai_books', (business, True)) is True
    assert rpc(admin, 'get_ai_books_status', (business,)) == {'available': True, 'paused': False, 'on': True, 'may_change': False}
    assert reserve(admin, business)['reserved'] is True
    rpc(owner, 'set_ai_books', (business, False))
    with pytest.raises(psycopg.errors.RaiseException, match='AI_BOOKS_OFF'):
        reserve(admin, business)


def test_other_businesses_cannot_see_or_switch_and_tables_are_closed():
    owner, business = member()
    stranger, _ = member()
    for name, args in (('get_ai_books_status', (business,)), ('set_ai_books', (business, True))):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            rpc(stranger, name, args)
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE authenticated')
        for table in ('ai_private.business_books', 'ai_private.books_answers'):
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                with c.transaction():
                    c.execute(f'SELECT * FROM {table}')


def test_only_metadata_is_kept_once_per_request_and_the_daily_ceiling_turns_books_off():
    owner, business = member()
    enable()
    cacu_books(books_daily_tokens=3000)
    rpc(owner, 'set_ai_books', (business, True))
    key = uuid4()
    assert reserve(owner, business, key)['reserved'] is True
    assert record(owner, business, key) == {'paused': False}
    assert record(owner, business, key, tokens=(9000, 9000)) == {'paused': False}  # a second record for the same request is ignored
    with psycopg.connect(URL) as c:
        rows = c.execute('SELECT tools, input_tokens, output_tokens, figure_check FROM ai_private.books_answers').fetchall()
        columns = {r[0] for r in c.execute("SELECT column_name FROM information_schema.columns WHERE table_schema='ai_private' AND table_name='books_answers'")}
    assert rows == [(['profit_summary'], 1000, 200, 'passed')]
    assert not columns & {'question', 'answer', 'prompt', 'content'}
    with pytest.raises(psycopg.errors.InvalidParameterValue, match='AI_INVALID_REQUEST'):
        record(owner, business, uuid4())  # nothing was reserved under this key
    with pytest.raises(psycopg.errors.InvalidParameterValue, match='AI_INVALID_REQUEST'):
        rpc(owner, 'record_ai_books', (business, key, ["x'; DROP TABLE y"], 1, 1, 1, 'passed', 'completed'))

    second = uuid4()
    reserve(owner, business, second)
    assert record(owner, business, second, tokens=(1500, 400)) == {'paused': True}  # 3,100 tokens today
    assert rpc(owner, 'get_ai_books_status', (business,))['available'] is False
    assert rpc(owner, 'get_ai_books_status', (business,))['paused'] is True
    with pytest.raises(psycopg.errors.RaiseException, match='AI_BOOKS_OFF'):
        reserve(owner, business)


def test_a_member_cannot_trip_the_ceiling_with_made_up_token_counts():
    owner, business = member()
    enable()
    cacu_books(books_daily_tokens=200000)
    rpc(owner, 'set_ai_books', (business, True))
    key = uuid4()
    reserve(owner, business, key)
    assert record(owner, business, key, tokens=(9_000_000, 9_000_000)) == {'paused': False}  # counted as 50,000 each way
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT input_tokens, output_tokens FROM ai_private.books_answers').fetchone() == (50000, 50000)


def test_books_answers_use_the_plan_allowance_and_shared_limits():
    owner, business = member()
    enable(actor_per_day=1)
    cacu_books()
    rpc(owner, 'set_ai_books', (business, True))
    assert reserve(owner, business)['reserved'] is True
    with pytest.raises(psycopg.errors.RaiseException, match='AI_RATE_LIMIT'):
        reserve(owner, business)
