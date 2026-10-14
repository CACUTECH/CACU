"""Direct SQL/RLS verification against disposable local management fixtures."""
import json
from pathlib import Path
from uuid import uuid4
import psycopg
import pytest
from test_management_postgres import managed, database, URL

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')

@pytest.fixture
def hr(managed):
    d = managed
    employee, attendance, foreign_employee, foreign_business = uuid4(), uuid4(), uuid4(), uuid4()
    with psycopg.connect(URL) as c:
        c.execute("""CREATE TABLE public.employees(id uuid PRIMARY KEY,business_id uuid,monthly_salary numeric,full_name text);
          CREATE TABLE public.attendance(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid,employee_id uuid,check_out timestamptz);
          ALTER TABLE employees ENABLE ROW LEVEL SECURITY; ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
          GRANT SELECT,INSERT,UPDATE,DELETE ON employees,attendance TO authenticated;
          CREATE POLICY employee_manager ON employees TO authenticated USING(public.has_business_role(business_id,ARRAY['owner','admin']::public.membership_role[]));
          CREATE POLICY old_attendance_member ON attendance TO authenticated USING(public.is_business_member(business_id)) WITH CHECK(public.is_business_member(business_id));
        """)
        c.execute('INSERT INTO businesses(id,name) VALUES(%s,%s)',(foreign_business,'Other business'))
        c.execute('INSERT INTO employees VALUES(%s,%s,100,%s),(%s,%s,200,%s)',(employee,d[1],'Employee',foreign_employee,foreign_business,'Foreign employee'))
        c.execute('INSERT INTO attendance VALUES(%s,%s,%s,NULL)',(attendance,d[1],employee))
        before=c.execute('SELECT to_jsonb(a) FROM attendance a').fetchall()
        c.execute(Path('../supabase/migrations/20261014083939_restrict_hr_data_access.sql').read_text())
        assert c.execute('SELECT to_jsonb(a) FROM attendance a').fetchall()==before
    return d,employee,attendance,foreign_employee


def actor(d,role,active=True):
    identity=uuid4()
    with psycopg.connect(URL) as c:
        c.execute('INSERT INTO memberships(business_id,user_id,role,is_active) VALUES(%s,%s,%s,%s)',(d[1],identity,role,active))
    return identity


def as_actor(c,identity):
    c.execute('SET LOCAL ROLE authenticated')
    c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':str(identity)}),))


@pytest.mark.parametrize('role,expected',[('owner',1),('admin',1),('editor',0),('viewer',0)])
def test_direct_attendance_and_salary_reads_match_existing_hr_roles(hr,role,expected):
    d,_,_,_=hr
    identity=d[2] if role=='owner' else actor(d,role)
    with psycopg.connect(URL) as c:
        as_actor(c,identity)
        assert c.execute('SELECT count(*) FROM attendance').fetchone()[0]==expected
        assert c.execute('SELECT count(monthly_salary) FROM employees').fetchone()[0]==expected
        assert c.execute('UPDATE attendance SET check_out=now() RETURNING id').fetchall()==([] if not expected else c.execute('SELECT id FROM attendance').fetchall())


def test_deactivated_admin_and_outsider_are_denied(hr):
    d,_,_,_=hr
    for identity in [actor(d,'admin',False),uuid4()]:
        with psycopg.connect(URL) as c:
            as_actor(c,identity)
            assert c.execute('SELECT count(*) FROM attendance').fetchone()[0]==0
            assert c.execute('DELETE FROM attendance RETURNING id').fetchall()==[]


def test_manager_can_record_own_employee_but_cannot_use_foreign_employee(hr):
    d,employee,_,foreign=hr
    with psycopg.connect(URL) as c:
        as_actor(c,d[2]);c.execute('INSERT INTO attendance(business_id,employee_id) VALUES(%s,%s)',(d[1],employee))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with psycopg.connect(URL) as c:
            as_actor(c,d[2]);c.execute('INSERT INTO attendance(business_id,employee_id) VALUES(%s,%s)',(d[1],foreign))
