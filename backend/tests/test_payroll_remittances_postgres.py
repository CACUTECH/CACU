"""Payroll remittances, part 1 (E21 R4): each employee's tax state and PFA, saved by Owners and Admins through one
audited function, and the schedules read from an approved run's payslips."""
from decimal import Decimal
from pathlib import Path
from uuid import uuid4
import psycopg
import pytest
from test_management_postgres import managed, database, URL  # noqa: F401
from test_hr_workflows_postgres import PERIOD, as_actor, hire, hr, member, query, write  # noqa: F401

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


@pytest.fixture
def staff(hr):
    d, _ = hr
    with psycopg.connect(URL) as c:
        c.execute(Path('../supabase/migrations/20261203090000_payroll_remittances.sql').read_text(encoding='utf-8'))
    return d


def save(d, employee, state, pfa, actor=None):
    with psycopg.connect(URL) as c:
        as_actor(c, actor or d[2])
        return c.execute('SELECT public.hr_save_remittance_details(%s,%s,%s,%s)', (d[1], employee, state, pfa)).fetchone()[0]


def schedule(d, run, actor=None):
    with psycopg.connect(URL) as c:
        as_actor(c, actor or d[2])
        return c.execute('SELECT public.hr_remittance_schedule(%s,%s)', (d[1], run)).fetchone()[0]


def test_tax_state_and_pfa_are_saved_by_managers_and_recorded_in_history(staff):
    d = staff
    ada = hire(d)['id']
    assert save(d, ada, 'Lagos', '  Stanbic   IBTC Pension Managers ') == {'tax_state': 'Lagos', 'pfa': 'Stanbic IBTC Pension Managers'}
    assert save(d, ada, 'Lagos', 'Stanbic IBTC Pension Managers') == {'tax_state': 'Lagos', 'pfa': 'Stanbic IBTC Pension Managers'}  # no change
    history = query(d, "SELECT details->'fields' FROM hr_private.audit WHERE record_id=%s AND event='employee.remittance'", (ada,))
    assert [h[0] for h in history] == [['tax_state', 'pfa']]  # the unchanged save is not recorded
    with pytest.raises(psycopg.Error, match='INVALID_TAX_STATE'):
        save(d, ada, 'Lagos State', None)
    with pytest.raises(psycopg.Error, match='EMPLOYEE_NOT_FOUND'):
        save(d, uuid4(), 'Lagos', None)
    editor = member(d, 'editor')
    with pytest.raises(psycopg.Error):
        save(d, ada, 'Ogun', None, actor=editor)
    with pytest.raises(psycopg.Error):  # nobody writes the table directly
        with psycopg.connect(URL) as c:
            as_actor(c, d[2])
            c.execute("UPDATE hr_remittance_details SET tax_state='Ogun'")
    assert query(d, 'SELECT tax_state FROM hr_remittance_details WHERE employee_id=%s', (ada,)) == [('Lagos',)]


def test_schedules_come_from_an_approved_runs_payslips_with_what_is_missing(staff):
    d = staff
    ada = hire(d, tax_id='1234567890', pension_pin='PEN100200300400')['id']
    bisi = hire(d, name='Bisi Ade', nhf_enrolled=True)['id']
    save(d, ada, 'Lagos', 'Stanbic IBTC Pension Managers')
    defaults = query(d, 'SELECT public.hr_payroll_defaults()')[0][0]
    write(d, 'payroll.rules', {'rules': defaults})
    draft = write(d, 'payroll.create', {'period': PERIOD})
    with pytest.raises(psycopg.Error, match='PAYROLL_RUN_NOT_APPROVED'):
        schedule(d, draft['id'])
    run = write(d, 'payroll.approve', id=draft['id'], version=draft['version'])['id']
    result = schedule(d, run)
    assert result['run']['employee_count'] == 2
    by = {p['name']: p for p in result['payslips']}
    assert (by['Ada Obi']['tax_state'], by['Ada Obi']['pfa'], by['Ada Obi']['tax_id'], by['Ada Obi']['pension_pin']) == \
        ('Lagos', 'Stanbic IBTC Pension Managers', '1234567890', 'PEN100200300400')
    assert by['Bisi Ade']['tax_state'] is None and Decimal(str(by['Bisi Ade']['nhf'])) > 0
    assert Decimal(str(by['Ada Obi']['paye'])) == Decimal('62420')  # the Nigeria Tax Act worked example
    assert Decimal(str(by['Ada Obi']['taxable_monthly'])) == Decimal('444000')  # 5,328,000 a year
    assert Decimal(str(result['totals']['paye'])) == sum(Decimal(str(p['paye'])) for p in result['payslips'])
    with pytest.raises(psycopg.Error):
        schedule(d, run, actor=member(d, 'viewer'))
