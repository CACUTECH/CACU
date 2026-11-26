"""The lender pack (Doc 15 FRA-006..008, FR-184; E19 R3 part 3): only the owner on the Chairman plan shares it; the
owner previews exactly what will be shared and the confirmation must match; the pack holds the statements, the
assessment, a completeness note and the profile, and nothing else; the link opens without an account until it
expires or is withdrawn; every opening is logged; only the token's hash is kept; a share is never edited."""
import hashlib
import json
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.funding_pack import ShareCreate, ShareDraft, list_shares, pack_hash, preview, share, withdraw
from cacu.accounting.readiness import NOTICE, assess
from test_corrections_postgres import live, call, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_readiness_postgres import plan, started, switch

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
DRAFT = {'recipient_name': 'Amaka Obi', 'recipient_organisation': 'Example Microfinance Bank', 'purpose': 'Working capital loan application'}


@pytest.fixture
def assessed(live):
    switch(True)
    started(live, 8)
    call(live, 'owner', lambda s, a: assess(s, a))
    return live


def opened(token):
    """The link as a lender opens it: no account, the public role."""
    with psycopg.connect(URL) as c:
        c.execute('GRANT USAGE ON SCHEMA public TO anon')  # as on Supabase
        c.execute('SET LOCAL ROLE anon')
        return c.execute('SELECT public.funding_pack(%s)', (token,)).fetchone()[0]


def test_only_the_owner_on_the_chairman_plan_can_share(assessed):
    live = assessed
    with pytest.raises(HTTPException) as refused:
        call(live, 'admin', lambda s, a: preview(s, a, ShareDraft(**DRAFT)))
    assert (refused.value.status_code, refused.value.detail) == (403, 'Only the business owner can share the lender pack.')
    plan(live, 'GROW')
    with pytest.raises(HTTPException) as refused:
        call(live, 'owner', lambda s, a: preview(s, a, ShareDraft(**DRAFT)))
    assert (refused.value.status_code, refused.value.detail) == (403, 'Sharing a lender pack comes with the Chairman plan.')
    plan(live, 'TOP')
    assert call(live, 'owner', lambda s, a: preview(s, a, ShareDraft(**DRAFT)))['pack']['kind'] == 'cacu_funding_pack'


def test_the_pack_holds_what_doc_15_lists_and_nothing_else(assessed):
    live = assessed
    seen = call(live, 'owner', lambda s, a: preview(s, a, ShareDraft(**DRAFT)))
    pack = seen['pack']
    assert set(pack) == {'kind', 'version', 'notice', 'label', 'prepared_on', 'business', 'period', 'statements', 'assessment', 'completeness'}
    assert pack['notice'] == NOTICE and pack['statements']['tier'] == 'Management statements, not reviewed'  # BR-061
    assert set(pack['statements']) >= {'income_statement', 'financial_position', 'changes_in_equity', 'cash_flow'}
    assert all('recommendations' not in d for d in pack['assessment']['dimensions'])  # the owner's own plan stays with them
    assert pack['completeness']['dimensions_total'] == 7 and pack['completeness']['months'] == 8
    text = json.dumps(pack)
    assert '"account_id"' not in text and '"business_id"' not in text and str(live.business) not in text
    with psycopg.connect(URL) as c:
        names = [r[0] for r in c.execute('SELECT name FROM customers WHERE business_id=%s UNION SELECT name FROM suppliers WHERE business_id=%s',
                                         (live.business, live.business)) if r[0]]
    assert not [n for n in names if n in text]  # no customer or supplier names
    again = call(live, 'owner', lambda s, a: preview(s, a, ShareDraft(**DRAFT)))
    assert again['pack_sha256'] == seen['pack_sha256'] == pack_hash(pack)  # the same books give the same pack


def test_a_share_must_match_the_preview_and_opens_until_withdrawn(assessed):
    live = assessed
    seen = call(live, 'owner', lambda s, a: preview(s, a, ShareDraft(**DRAFT)))
    key = uuid4()
    with pytest.raises(HTTPException, match='Look at it again'):
        call(live, 'owner', lambda s, a: share(s, a, ShareCreate(**DRAFT, request_key=key, pack_sha256='0' * 64)))
    made = call(live, 'owner', lambda s, a: share(s, a, ShareCreate(**DRAFT, request_key=key, pack_sha256=seen['pack_sha256'])))
    token = made['token']
    assert len(token) == 64 and made['status'] == 'live'
    retried = call(live, 'owner', lambda s, a: share(s, a, ShareCreate(**DRAFT, request_key=key, pack_sha256=seen['pack_sha256'])))
    assert retried['id'] == made['id'] and retried['token'] is None  # the token is shown once
    with psycopg.connect(URL) as c:
        row = c.execute('SELECT token_sha256, expires_at - created_at, pack FROM accounting.funding_share').fetchone()
        assert row[0] == hashlib.sha256(token.encode()).hexdigest() and token not in json.dumps(row[2])
        assert row[1].days == 30 and row[2] == seen['pack']  # what the owner saw is what is kept

    got = opened(token)
    assert got['status'] == 'opened' and got['pack'] == seen['pack'] and got['recipient_name'] == 'Amaka Obi'
    assert got['purpose'] == 'Working capital loan application'
    assert opened('f' * 64) is None and opened('not a token') is None  # unknown links show nothing, and are not logged

    done = call(live, 'owner', lambda s, a: withdraw(s, a, made['id']))
    assert done['status'] == 'withdrawn' and done['times_opened'] == 1
    assert opened(token) == {'status': 'withdrawn'}
    switch(False)
    assert opened(token) == {'status': 'switched_off'}
    switch(True)
    listed = call(live, 'owner', lambda s, a: list_shares(s, a))
    assert [(s['recipient_name'], s['status'], s['times_opened']) for s in listed] == [('Amaka Obi', 'withdrawn', 1)]
    assert [o['outcome'] for o in listed[0]['openings']] == ['switched_off', 'withdrawn', 'opened']  # FR-184, newest first


def test_an_expired_link_stops_and_a_share_is_never_edited(assessed):
    live = assessed
    seen = call(live, 'owner', lambda s, a: preview(s, a, ShareDraft(**DRAFT, expires_in_days=7)))
    made = call(live, 'owner', lambda s, a: share(s, a, ShareCreate(**DRAFT, expires_in_days=7, request_key=uuid4(), pack_sha256=seen['pack_sha256'])))
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT expires_at - created_at FROM accounting.funding_share').fetchone()[0].days == 7
        token = 'a' * 64
        c.execute("""INSERT INTO accounting.funding_share(business_id, assessment_id, request_key, recipient_name, purpose, pack, pack_sha256,
              token_sha256, expires_at, created_by, created_at)
            SELECT business_id, assessment_id, gen_random_uuid(), recipient_name, purpose, pack, pack_sha256, %s, now() - interval '1 day', created_by,
              now() - interval '31 days' FROM accounting.funding_share WHERE id=%s""", (hashlib.sha256(token.encode()).hexdigest(), made['id']))
    assert opened(token) == {'status': 'expired'}
    with psycopg.connect(URL) as c:
        with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
            c.execute("UPDATE accounting.funding_share SET purpose='Something else' WHERE id=%s", (made['id'],))
    with psycopg.connect(URL) as c:
        with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
            c.execute('DELETE FROM accounting.funding_share WHERE id=%s', (made['id'],))
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE cacu_runtime')
        for sql in ("UPDATE accounting.funding_share SET pack='{}'::jsonb", 'DELETE FROM accounting.funding_share_access',
                    "INSERT INTO accounting.funding_share_access(business_id, share_id, outcome) SELECT business_id, id, 'opened' FROM accounting.funding_share"):
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                with c.transaction():
                    c.execute(sql)

