"""Payroll remittances, part 2 (E21 R4): an Owner or Admin shares an approved payslip with its employee by a link that
opens without an account. Only the token's hash is stored; links expire, can be withdrawn and are replaced by sharing
again; the payslip shown masks the tax ID and pension PIN and carries nothing else about the employee."""
from pathlib import Path
from uuid import uuid4
import psycopg
import pytest
from test_management_postgres import managed, database, URL  # noqa: F401
from test_hr_workflows_postgres import PERIOD, as_actor, hire, hr, member, query, write  # noqa: F401

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


@pytest.fixture
def slips(hr):
    d, _ = hr
    with psycopg.connect(URL) as c:
        c.execute(Path('../supabase/migrations/20261203090000_payroll_remittances.sql').read_text(encoding='utf-8'))
        c.execute(Path('../supabase/migrations/20261204090000_payslip_links.sql').read_text(encoding='utf-8'))
        c.execute('GRANT USAGE ON SCHEMA public TO anon')  # as on Supabase
    ada = hire(d, tax_id='1234567890', pension_pin='PEN100200300400', email='ada@example.test', phone='08030000000')['id']
    defaults = query(d, 'SELECT public.hr_payroll_defaults()')[0][0]
    write(d, 'payroll.rules', {'rules': defaults})
    draft = write(d, 'payroll.create', {'period': PERIOD})
    return d, ada, draft


def approve(d, draft):
    return write(d, 'payroll.approve', id=draft['id'], version=draft['version'])['id']


def payslip(d, run, employee):
    return query(d, 'SELECT id FROM hr_payslips WHERE run_id=%s AND employee_id=%s', (run, employee))[0][0]


def call(d, sql, args, actor=None):
    with psycopg.connect(URL) as c:
        as_actor(c, actor or d[2])
        return c.execute(sql, args).fetchone()[0]


def share(d, slip, days=30, actor=None):
    return call(d, 'SELECT public.hr_share_payslip(%s,%s,%s)', (d[1], slip, days), actor)


def opened(token):
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE anon')
        return c.execute('SELECT public.public_payslip(%s)', (token,)).fetchone()[0]


def payslip_events(d, employee):
    """The payslip entries in the employee's HR history, oldest first (hr_history lists newest first)."""
    history = query(d, 'SELECT public.hr_history(%s,%s)', (d[1], employee))[0][0]
    return [h['event'] for h in reversed(history) if h['event'].startswith('payslip.')]


def test_an_approved_payslip_opens_by_its_link_with_identity_numbers_masked(slips):
    d, ada, draft = slips
    with pytest.raises(psycopg.Error, match='PAYROLL_RUN_NOT_APPROVED'):
        share(d, payslip(d, draft['id'], ada))
    run = approve(d, draft)
    slip = payslip(d, run, ada)
    link = share(d, slip)
    assert len(link['token']) == 64
    page = opened(link['token'])
    assert page['employee']['name'] == 'Ada Obi' and page['employee']['job_title'] == 'Cashier'
    assert page['employee']['tax_id'] == '••••7890' and page['employee']['pension_pin'] == '••••0400'
    assert float(page['earnings']['gross']) == 500000 and float(page['deductions']['paye']) == 62420
    assert float(page['net']) == float(page['earnings']['gross']) - sum(float(v) for v in page['deductions'].values())
    text = str(page)
    for secret in ('1234567890', 'PEN100200300400', 'ada@example.test', '08030000000', str(ada)):
        assert secret not in text  # nothing else about the employee
    # The table never holds a working link, and nobody reads it directly.
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT count(*) FROM hr_payslip_links WHERE token_sha256=%s', (link['token'],)).fetchone()[0] == 0
    with pytest.raises(psycopg.Error):
        query(d, 'SELECT * FROM hr_payslip_links')
    status = call(d, 'SELECT public.hr_payslip_links(%s,%s)', (d[1], run))
    assert [(s['payslip_id'], s['open_count']) for s in status] == [(str(slip), 1)]
    events = payslip_events(d, ada)
    assert events == ['payslip.shared']


def test_links_are_replaced_withdrawn_and_expire(slips):
    d, ada, draft = slips
    slip = payslip(d, approve(d, draft), ada)
    first = share(d, slip)
    second = share(d, slip, days=7)
    assert opened(first['token']) is None and opened(second['token']) is not None  # sharing again replaces the link
    assert call(d, 'SELECT public.hr_withdraw_payslip_link(%s,%s)', (d[1], slip)) is True
    assert opened(second['token']) is None
    assert call(d, 'SELECT public.hr_withdraw_payslip_link(%s,%s)', (d[1], slip)) is False
    third = share(d, slip, days=1)
    with psycopg.connect(URL) as c:
        c.execute("UPDATE hr_payslip_links SET created_at=now()-interval '2 days', expires_at=now()-interval '1 day' WHERE revoked_at IS NULL")
    assert opened(third['token']) is None
    assert opened('0' * 64) is None and opened('not a token') is None
    for days in (0, 91, None):
        with pytest.raises(psycopg.Error, match='INVALID_EXPIRY'):
            share(d, slip, days=days)
    events = payslip_events(d, ada)
    assert events == ['payslip.shared', 'payslip.shared', 'payslip.withdrawn', 'payslip.shared']


@pytest.mark.parametrize('role', ['editor', 'viewer'])
def test_only_owners_and_admins_share_and_withdraw(slips, role):
    d, ada, draft = slips
    slip = payslip(d, approve(d, draft), ada)
    other = member(d, role)
    with pytest.raises(psycopg.Error):
        share(d, slip, actor=other)
    with pytest.raises(psycopg.Error):
        call(d, 'SELECT public.hr_withdraw_payslip_link(%s,%s)', (d[1], slip), other)
    with pytest.raises(psycopg.Error, match='PAYSLIP_NOT_FOUND'):
        share(d, uuid4())
    assert share(d, slip, actor=member(d, 'admin'))['payslip_id'] == str(slip)
