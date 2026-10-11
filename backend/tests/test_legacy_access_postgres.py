"""Legacy function upgrade checks; destructive fixtures in localhost _test DB only."""
import json
import re
import os
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4
import psycopg
import pytest
DSN = os.getenv('CACU_TEST_DATABASE_URL')
pytestmark = pytest.mark.skipif(not DSN, reason='Disposable PostgreSQL required')

@pytest.fixture
def legacy_db():
    parsed = urlparse(DSN)
    assert parsed.hostname in {'localhost', '127.0.0.1', 'postgres'} and parsed.path.endswith('_test')
    actor, tenant, foreign = uuid4(), uuid4(), uuid4()
    with psycopg.connect(DSN) as c:
        c.execute('DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE SCHEMA auth')
        c.execute("""DO $$ BEGIN
          IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
          IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        END $$;
        CREATE TYPE public.membership_role AS ENUM ('owner','admin','editor','viewer');
        CREATE TABLE public.memberships(business_id uuid,user_id uuid,role public.membership_role);
        CREATE TABLE public.financial_transactions(business_id uuid,amount numeric,type text,date date);
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
        CREATE FUNCTION public.is_business_member(b uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT EXISTS(SELECT FROM public.memberships WHERE business_id=b AND user_id=auth.uid()) $$;
        CREATE FUNCTION public.has_business_role(b uuid,roles public.membership_role[]) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT EXISTS(SELECT FROM public.memberships WHERE business_id=b AND user_id=auth.uid() AND role=ANY(roles)) $$;
        GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
        """)
        c.execute('INSERT INTO public.memberships VALUES(%s,%s,%s)', (tenant,actor,'viewer'))
        c.execute("INSERT INTO public.financial_transactions VALUES(%s,125,'Income',CURRENT_DATE)", (tenant,))
        baseline = Path('../supabase/migrations/0001_init.sql').read_text(encoding='utf-8-sig')
        for definition in re.findall(r'CREATE OR REPLACE FUNCTION \w+\(.*?\$\$ LANGUAGE plpgsql SECURITY DEFINER;', baseline, re.S):
            c.execute(definition)
        migration = next(Path('../supabase/migrations').glob('*_harden_legacy_function_access.sql'))
        c.execute(migration.read_text(encoding='utf-8'))
    return actor,tenant,foreign

def connect_as(actor,role='authenticated'):
    c=psycopg.connect(DSN)
    c.execute('SET ROLE '+role)
    c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub':str(actor)}) if actor else '{}',))
    return c

def test_upgrade_closes_anonymous_and_public_execute(legacy_db):
    with psycopg.connect(DSN) as c:
        rows=c.execute("SELECT p.proname,has_function_privilege('anon',p.oid,'EXECUTE'),p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('process_sale','get_business_kpis','get_revenue_trend','record_audit','adjust_inventory_stock','create_invoice_atomic','record_payment_atomic')").fetchall()
        assert len(rows)==7
        assert all(not row[1] and 'search_path=pg_catalog, public, pg_temp' in row[2] for row in rows)
    with connect_as(None,'anon') as c:
        with pytest.raises(psycopg.errors.InsufficientPrivilege): c.execute('SELECT * FROM public.get_business_kpis(%s,CURRENT_DATE,CURRENT_DATE)',(legacy_db[1],))

def test_kpis_require_current_tenant_membership(legacy_db):
    actor,tenant,foreign=legacy_db
    with connect_as(actor) as c:
        assert c.execute('SELECT * FROM public.get_business_kpis(%s,CURRENT_DATE,CURRENT_DATE)',(tenant,)).fetchone()[0]==125
    with connect_as(actor) as c:
        with pytest.raises(psycopg.errors.InsufficientPrivilege): c.execute('SELECT * FROM public.get_business_kpis(%s,CURRENT_DATE,CURRENT_DATE)',(foreign,))

@pytest.mark.parametrize('call',[
 "SELECT public.adjust_inventory_stock(%s,%s,1)",
 "SELECT public.process_sale(%s,%s,'[]'::jsonb,'Cash',1)",
 "SELECT public.record_payment_atomic(%s,%s,NULL,1,'Cash','test')",
 "SELECT public.create_invoice_atomic(%s,%s,'test','Invoice','Draft',CURRENT_DATE,CURRENT_DATE,1,0,1,false,'','[]'::jsonb)",
])
def test_viewer_cannot_invoke_privileged_writes(legacy_db,call):
    actor,tenant,_=legacy_db
    args=(uuid4(),tenant) if 'adjust_inventory_stock' in call else (tenant,uuid4())
    with connect_as(actor) as c:
        with pytest.raises(psycopg.errors.InsufficientPrivilege): c.execute(call,args)
