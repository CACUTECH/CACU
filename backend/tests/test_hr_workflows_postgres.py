"""HR employee, attendance and payroll commands on disposable local PostgreSQL fixtures."""
import json
from datetime import date
from decimal import Decimal
from pathlib import Path
from uuid import uuid4
import psycopg
from psycopg.types.json import Jsonb
import pytest
from test_management_postgres import managed, database, URL

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
PERIOD = date.today().strftime('%Y-%m')


@pytest.fixture
def hr(managed):
    d = managed
    with psycopg.connect(URL) as c:
        c.execute("""DROP SCHEMA IF EXISTS hr_private CASCADE;
          CREATE TABLE public.employees(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid REFERENCES public.businesses(id),
            full_name text NOT NULL CHECK(char_length(btrim(full_name))>0),job_title text,department text,
            employment_status text NOT NULL DEFAULT 'active' CONSTRAINT employees_employment_status_check CHECK(employment_status IN ('active','on_leave','exited')),
            start_date date,end_date date,monthly_salary numeric CHECK(monthly_salary>=0),bank_name text,bank_account_number text,bank_account_name text,
            email text,phone text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
          CREATE TABLE public.attendance(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid REFERENCES public.businesses(id),
            employee_id uuid REFERENCES public.employees(id) ON DELETE CASCADE,check_in timestamptz,check_out timestamptz,status text DEFAULT 'Present',created_at timestamptz DEFAULT now());
          ALTER TABLE employees ENABLE ROW LEVEL SECURITY; ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
          GRANT SELECT,INSERT,UPDATE,DELETE ON employees,attendance TO authenticated;
          CREATE POLICY employee_manager ON employees TO authenticated USING(public.has_business_role(business_id,ARRAY['owner','admin']::public.membership_role[]));
          CREATE POLICY attendance_member ON attendance TO authenticated USING(public.is_business_member(business_id)) WITH CHECK(public.is_business_member(business_id));""")
        legacy = uuid4()
        c.execute("INSERT INTO employees(id,business_id,full_name,monthly_salary) VALUES(%s,%s,'Legacy employee',90000)", (legacy, d[1]))
        c.execute("INSERT INTO attendance(business_id,employee_id,check_in,check_out) VALUES(%s,%s,'2026-03-02T07:30:00Z','2026-03-02T16:00:00Z')", (d[1], legacy))
        c.execute(Path('../supabase/migrations/20261014083939_restrict_hr_data_access.sql').read_text())
        c.execute(Path('../supabase/migrations/20261029090000_hr_workflows.sql').read_text(encoding='utf-8'))
        c.execute(Path('../supabase/migrations/20261030090000_hr_status_codes.sql').read_text(encoding='utf-8'))
        assert c.execute('SELECT work_date FROM attendance').fetchone()[0] == date(2026, 3, 2)
    return d, legacy


def member(d, role, active=True):
    identity = uuid4()
    with psycopg.connect(URL) as c:
        c.execute('INSERT INTO memberships(business_id,user_id,role,is_active) VALUES(%s,%s,%s,%s)', (d[1], identity, role, active))
    return identity


def as_actor(c, identity):
    c.execute('SET LOCAL ROLE authenticated')
    c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': str(identity)}),))


def write(d, op, details=None, id=None, version=None, key=None, actor=None):
    with psycopg.connect(URL) as c:
        as_actor(c, actor or d[2])
        return c.execute('SELECT public.hr_write(%s,%s,%s,%s,%s,%s)', (d[1], key or uuid4(), op, id, version, Jsonb(details or {}))).fetchone()[0]


def query(d, sql, args=(), actor=None):
    with psycopg.connect(URL) as c:
        as_actor(c, actor or d[2])
        return c.execute(sql, args).fetchall()


def fails(code, *args, **kwargs):
    with pytest.raises(psycopg.Error, match=code):
        write(*args, **kwargs)


PAY = {'pay_basic': 300000, 'pay_housing': 100000, 'pay_transport': 50000, 'pay_other': 50000, 'annual_rent': 1200000}


def hire(d, name='Ada Obi', **extra):
    return write(d, 'employee.save', {'full_name': name, 'job_title': 'Cashier', **PAY, **extra})


def test_create_is_replay_safe_and_key_reuse_is_refused(hr):
    d, _ = hr
    key = uuid4()
    first = write(d, 'employee.save', {'full_name': ' Ada Obi ', **PAY}, key=key)
    again = write(d, 'employee.save', {'full_name': ' Ada Obi ', **PAY}, key=key)
    assert first['replayed'] is False and again['replayed'] is True and again['id'] == first['id']
    assert query(d, "SELECT full_name,monthly_salary,employment_status FROM employees WHERE id=%s", (first['id'],)) == [('Ada Obi', Decimal('500000'), 'active')]
    fails('REQUEST_KEY_REUSED', d, 'employee.save', {'full_name': 'Someone else'}, key=key)


@pytest.mark.parametrize('role,active', [('editor', True), ('viewer', True), ('admin', False)])
def test_non_managers_cannot_write(hr, role, active):
    d, _ = hr
    fails('ACCESS_DENIED', d, 'employee.save', {'full_name': 'Blocked'}, actor=member(d, role, active))


def test_admin_can_manage_and_direct_table_writes_are_revoked(hr):
    d, legacy = hr
    admin = member(d, 'admin')
    assert write(d, 'employee.save', {'full_name': 'Admin hire'}, actor=admin)['version'] == 1
    for sql in ["UPDATE employees SET monthly_salary=1 WHERE id=%s", "DELETE FROM attendance WHERE employee_id=%s"]:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            query(d, sql, (legacy,))


@pytest.mark.parametrize('details,code', [
    ({'full_name': ''}, 'INVALID_EMPLOYEE'), ({'full_name': 'A', 'pay_basic': 10.005}, 'INVALID_AMOUNT'),
    ({'full_name': 'A', 'pay_basic': -1}, 'INVALID_AMOUNT'), ({'full_name': 'A', 'email': 'not-an-email'}, 'INVALID_EMPLOYEE'),
    ({'full_name': 'A', 'monthly_salary': 5}, 'UNSUPPORTED_FIELD'), ({'full_name': 'A', 'business_id': str(uuid4())}, 'UNSUPPORTED_FIELD'),
    ({'full_name': 'A', 'nhis_monthly': 10}, 'INVALID_AMOUNT'), ({'full_name': 'A', 'start_date': '2026-02-30'}, 'INVALID_EMPLOYEE'), ({'full_name': 'A', 'pension_enrolled': 'yes'}, 'INVALID_EMPLOYEE')])
def test_invalid_employee_input_is_refused(hr, details, code):
    fails(code, hr[0], 'employee.save', details)


def test_update_requires_current_version_and_history_lists_changed_fields(hr):
    d, legacy = hr
    fails('VERSION_CONFLICT', d, 'employee.save', {'full_name': 'Renamed'}, id=legacy, version=7)
    saved = write(d, 'employee.save', {'full_name': 'Legacy employee', 'department': 'Sales', **PAY}, id=legacy, version=1)
    assert saved['version'] == 2
    history = query(d, 'SELECT public.hr_history(%s,%s)', (d[1], legacy))[0][0]
    assert history[0]['event'] == 'employee.save' and 'department' in history[0]['fields'] and 'pay_basic' in history[0]['fields']
    assert 'full_name' not in history[0]['fields']
    other = uuid4()
    with psycopg.connect(URL) as c:
        c.execute('INSERT INTO businesses(id,name) VALUES(%s,%s)', (other, 'Other'))
        foreign = c.execute("INSERT INTO employees(business_id,full_name) VALUES(%s,'Foreign') RETURNING id", (other,)).fetchone()[0]
    fails('EMPLOYEE_NOT_FOUND', d, 'employee.save', {'full_name': 'Taken'}, id=foreign, version=1)
    with pytest.raises(psycopg.Error, match='ACCESS_DENIED'):
        query(d, 'SELECT public.hr_history(%s,%s)', (other, foreign))


def test_attendance_allows_one_open_shift_per_active_employee(hr):
    d, _ = hr
    hired = hire(d)
    shift = write(d, 'attendance.check_in', id=hired['id'])
    assert shift['work_date'] == str(date.today()) or shift['work_date']
    fails('ALREADY_CHECKED_IN', d, 'attendance.check_in', id=hired['id'])
    fails('OPEN_SHIFT', d, 'employee.status', {'status': 'suspended'}, id=hired['id'], version=1)
    closed = write(d, 'attendance.check_out', {'note': 'Left early'}, id=hired['id'])
    assert closed['id'] == shift['id'] and closed['check_out'] is not None
    fails('NOT_CHECKED_IN', d, 'attendance.check_out', id=hired['id'])
    write(d, 'employee.status', {'status': 'on_leave'}, id=hired['id'], version=1)
    fails('EMPLOYEE_NOT_ACTIVE', d, 'attendance.check_in', id=hired['id'])


def test_departure_and_rehire(hr):
    d, _ = hr
    hired = hire(d)
    fails('INVALID_DEPARTURE', d, 'employee.depart', {'end_date': '2026-02-30', 'reason': 'x'}, id=hired['id'], version=1)
    fails('INVALID_DEPARTURE', d, 'employee.depart', {'end_date': '2026-05-01', 'reason': ' '}, id=hired['id'], version=1)
    gone = write(d, 'employee.depart', {'end_date': str(date.today()), 'reason': 'Resigned'}, id=hired['id'], version=1)
    assert gone['employment_status'] == 'exited'
    fails('ALREADY_DEPARTED', d, 'employee.depart', {'end_date': str(date.today()), 'reason': 'Again'}, id=hired['id'], version=2)
    back = write(d, 'employee.status', {'status': 'active'}, id=hired['id'], version=2)
    assert back['employment_status'] == 'active'
    assert query(d, 'SELECT end_date,departure_reason FROM employees WHERE id=%s', (hired['id'],)) == [(None, None)]


def slip(d, employee):
    return query(d, 'SELECT gross,pension_employee,pension_employer,nhf,rent_relief_annual,chargeable_annual,paye_annual,paye,net FROM hr_payslips WHERE employee_id=%s', (employee,))[0]


def test_payroll_matches_nigeria_tax_act_worked_examples(hr):
    d, legacy = hr
    standard = hire(d)['id']
    low = write(d, 'employee.save', {'full_name': 'Low earner', 'pay_basic': 60000})['id']
    high = write(d, 'employee.save', {'full_name': 'High earner', 'pay_basic': 5000000, 'pension_enrolled': False})['id']
    housing = write(d, 'employee.save', {'full_name': 'NHF member', 'pay_basic': 200000, 'nhf_enrolled': True, 'nhis_monthly': 2500})['id']
    run = write(d, 'payroll.create', {'period': PERIOD})
    assert run['employee_count'] == 4 and run['excluded'] == [{'id': str(legacy), 'name': 'Legacy employee', 'reason': 'No pay structure'}]
    # Annual 6,000,000 gross, 432,000 pension, 240,000 rent relief: 330,000 + 419,040 = 749,040 PAYE.
    assert slip(d, standard) == tuple(Decimal(x) for x in ['500000', '36000', '45000', '0', '240000', '5328000', '749040', '62420', '401580'])
    assert slip(d, low)[6:] == (Decimal('0'), Decimal('0'), Decimal('55200'))
    # 60,000,000 chargeable spans all six bands: 12,930,000 a year.
    assert slip(d, high)[1] == 0 and slip(d, high)[6:8] == (Decimal('12930000'), Decimal('1077500'))
    nhf = slip(d, housing)
    assert nhf[3] == Decimal('5000') and nhf[5] == Decimal(12 * (200000 - 16000 - 5000 - 2500))
    totals = query(d, 'SELECT gross_total,net_total FROM hr_payroll_runs WHERE id=%s', (run['id'],))[0]
    assert totals[0] == Decimal('5760000') and totals[1] == sum(slip(d, e)[8] for e in [standard, low, high, housing])


def test_payroll_approval_requires_reviewed_rules_and_locks_the_run(hr):
    d, _ = hr
    hire(d)
    run = write(d, 'payroll.create', {'period': PERIOD})
    fails('PAYROLL_PERIOD_EXISTS', d, 'payroll.create', {'period': PERIOD})
    fails('PAYROLL_RULES_UNREVIEWED', d, 'payroll.approve', id=run['id'], version=run['version'])
    defaults = query(d, 'SELECT public.hr_payroll_defaults()')[0][0]
    fails('INVALID_PAYROLL_RULES', d, 'payroll.rules', {'rules': {**defaults, 'nhf_rate': 2}})
    fails('INVALID_PAYROLL_RULES', d, 'payroll.rules', {'rules': {**defaults, 'bands': [{'up_to': 100, 'rate': 0.1}, {'up_to': 50, 'rate': 0.2}, {'up_to': None, 'rate': 0.3}]}})
    assert write(d, 'payroll.rules', {'rules': defaults})['version'] == 1
    fails('VERSION_CONFLICT', d, 'payroll.rules', {'rules': defaults})
    # The draft kept its unreviewed snapshot, so it is cancelled and rebuilt on the reviewed rules.
    fails('PAYROLL_RULES_UNREVIEWED', d, 'payroll.approve', id=run['id'], version=run['version'])
    write(d, 'payroll.cancel', id=run['id'], version=run['version'])
    rebuilt = write(d, 'payroll.create', {'period': PERIOD})
    approved = write(d, 'payroll.approve', id=rebuilt['id'], version=rebuilt['version'])
    assert approved['status'] == 'approved'
    fails('PAYROLL_RUN_LOCKED', d, 'payroll.cancel', id=rebuilt['id'], version=approved['version'])
    with pytest.raises(psycopg.Error, match='PAYROLL_RECORD_IMMUTABLE'):
        with psycopg.connect(URL) as c:
            c.execute('UPDATE hr_payslips SET net=0 WHERE run_id=%s', (rebuilt['id'],))
    with pytest.raises(psycopg.Error, match='PAYROLL_RECORD_IMMUTABLE'):
        with psycopg.connect(URL) as c:
            c.execute('DELETE FROM hr_payroll_runs WHERE id=%s', (rebuilt['id'],))


@pytest.mark.parametrize('period', ['2025-12', '2099-01', '2026-13', '26-01'])
def test_invalid_payroll_periods(hr, period):
    hire(hr[0])
    fails('INVALID_PERIOD', hr[0], 'payroll.create', {'period': period})


def test_departed_employees_are_listed_not_paid_and_payroll_is_manager_only(hr):
    d, _ = hr
    hired = hire(d)
    write(d, 'employee.depart', {'end_date': str(date.today()), 'reason': 'Contract ended'}, id=hired['id'], version=1)
    fails('NO_ELIGIBLE_EMPLOYEES', d, 'payroll.create', {'period': PERIOD})
    hire(d, 'Stays')
    run = write(d, 'payroll.create', {'period': PERIOD})
    assert [x['name'] for x in run['excluded']] == ['Ada Obi', 'Legacy employee']
    editor = member(d, 'editor')
    assert query(d, 'SELECT count(*) FROM hr_payslips', actor=editor) == [(0,)]
    assert query(d, 'SELECT count(*) FROM hr_payslips') == [(1,)]


def test_status_codes_match_the_hosted_constraint(hr):
    d, legacy = hr
    assert query(d, 'SELECT employment_status FROM employees WHERE id=%s', (legacy,)) == [('active',)]
    fails('INVALID_STATUS', d, 'employee.status', {'status': 'Active'}, id=legacy, version=1)
    write(d, 'employee.status', {'status': 'suspended'}, id=legacy, version=1)
    with pytest.raises(psycopg.errors.CheckViolation):
        with psycopg.connect(URL) as c:
            c.execute("UPDATE employees SET employment_status='Departed' WHERE id=%s", (legacy,))
