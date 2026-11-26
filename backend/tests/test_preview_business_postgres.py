"""CACU's preview business (26 November 2026): one business CACU chooses sees every module, and the features behind
CACU's switches are on for it only while they stay off for everyone else. Only CACU changes the list."""
import json
import psycopg
import pytest
from cacu.accounting.payroll import _enabled as payroll_on
from cacu.accounting.posting import raw
from test_corrections_postgres import live, call, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


def preview(live, on):
    with psycopg.connect(URL) as c:
        c.execute('UPDATE accounting.payroll_switch SET enabled=false')
        c.execute('UPDATE accounting.funding_switch SET enabled=false')
        c.execute('DELETE FROM accounting.preview_business')
        if on:
            c.execute("INSERT INTO accounting.preview_business(business_id, reason) VALUES (%s, 'CACU demo and testing')", (live.business,))


def asked_by(live, who):
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE authenticated')
        c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': str(live.people[who])}),))
        return c.execute('SELECT public.cacu_preview(%s)', (live.business,)).fetchone()[0]


def test_switched_off_features_are_on_for_the_preview_business_only(live):
    preview(live, False)
    assert call(live, 'owner', lambda s, a: payroll_on(s)) is False
    assert call(live, 'owner', lambda s, a: raw(s, 'SELECT accounting.funding_access(%s)', (str(live.business),)).scalar())['enabled'] is False
    assert asked_by(live, 'owner') is False

    preview(live, True)
    assert call(live, 'owner', lambda s, a: payroll_on(s)) is True
    assert call(live, 'owner', lambda s, a: raw(s, 'SELECT accounting.funding_access(%s)', (str(live.business),)).scalar())['enabled'] is True
    assert asked_by(live, 'owner') is True and asked_by(live, 'viewer') is True
    assert asked_by(live, 'outsider') is False  # answered only to the business's own members
    with psycopg.connect(URL) as c:  # every other business keeps the switches off
        others = c.execute("""SELECT count(*) FROM public.businesses b WHERE b.id<>%s
            AND (accounting.funding_access(b.id)->>'enabled')::boolean""", (live.business,)).fetchone()[0]
    assert others == 0
    preview(live, False)


def test_only_cacu_changes_the_list(live):
    for role in ('cacu_runtime', 'authenticated'):
        with psycopg.connect(URL) as c:
            c.execute(f'SET LOCAL ROLE {role}')
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                c.execute("INSERT INTO accounting.preview_business(business_id, reason) VALUES (%s, 'let me in please')", (live.business,))
