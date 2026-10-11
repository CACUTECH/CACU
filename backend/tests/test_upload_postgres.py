"""Real PostgreSQL tests of the new migration; disposable localhost database only."""
import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4
import psycopg
import pytest

DSN=os.environ.get('CACU_TEST_DATABASE_URL')
pytestmark=pytest.mark.skipif(not DSN,reason='Disposable PostgreSQL test URL required')

@pytest.fixture
def uploads_db():
    assert urlparse(DSN).hostname in {'localhost','127.0.0.1','postgres'}
    assert urlparse(DSN).path.endswith('_test')
    with psycopg.connect(DSN) as c:
        c.execute('DROP SCHEMA IF EXISTS storage CASCADE; DROP SCHEMA IF EXISTS upload_private CASCADE; DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE SCHEMA storage; CREATE SCHEMA auth')
        c.execute("""DO $$ BEGIN
          IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
          IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
          IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
        END $$;
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
        """)

        c.execute("""GRANT USAGE ON SCHEMA public,storage,auth TO authenticated,anon,service_role;
        CREATE TABLE public.businesses(id uuid PRIMARY KEY,logo_url text);
        CREATE TABLE public.memberships(business_id uuid,user_id uuid,role text);
        CREATE TABLE public.invoices(id uuid PRIMARY KEY,business_id uuid);
        CREATE TABLE public.transactions(id uuid PRIMARY KEY,business_id uuid);
        CREATE TABLE public.financial_transactions(id uuid PRIMARY KEY,business_id uuid);
        CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
        CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,UNIQUE(bucket_id,name));
        ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
        GRANT ALL ON storage.objects TO authenticated,anon,service_role;
        CREATE POLICY legacy_broad_access ON storage.objects FOR ALL TO authenticated,anon USING(true) WITH CHECK(true);
        INSERT INTO storage.buckets VALUES('business-assets','business-assets',false,null,null),('business-logos','business-logos',true,null,null),('business-documents','business-documents',false,null,null);
        INSERT INTO storage.objects(bucket_id,name) VALUES('business-assets','historical-file.png');
        """)
        c.execute(next((Path(__file__).resolve().parents[2] / 'supabase/migrations').glob('*_secure_file_uploads.sql')).read_text(encoding='utf-8'))
        business,other,actor,invoice,foreign,receipt=map(str,[uuid4() for _ in range(6)])
        c.execute('INSERT INTO public.businesses(id) VALUES(%s),(%s)',(business,other))
        c.execute("INSERT INTO public.memberships VALUES(%s,%s,'owner')",(business,actor))
        c.execute('INSERT INTO public.invoices VALUES(%s,%s),(%s,%s)',(invoice,business,foreign,other))
        c.execute('INSERT INTO public.financial_transactions VALUES(%s,%s)',(receipt,business))
    return {'business':business,'other':other,'actor':actor,'invoice':invoice,'foreign':foreign,'receipt':receipt}

def user(c,d,role='authenticated',actor=None):
    c.execute('SET LOCAL ROLE '+role)
    c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':actor or d['actor']}),))

def reserve(c,d,purpose='logo',resource=None,name='file.png'):
    return c.execute('SELECT public.reserve_upload(%s,%s,%s,%s,%s)',(d['business'],purpose,resource or d['business'],name,100)).fetchone()[0]

def approve(c,row,size=100):
    c.execute('SET LOCAL ROLE service_role')
    return c.execute('SELECT public.approve_upload(%s,%s,%s,%s,%s)',(row['id'],'png','image/png',size,'a'*64)).fetchone()[0]

def test_roles_resource_and_tenant_checked_in_sql(uploads_db):
    d=uploads_db
    with psycopg.connect(DSN) as c:
        user(c,d);row=reserve(c,d);assert row['state']=='pending';c.commit()
        user(c,d)
        with pytest.raises(psycopg.errors.InsufficientPrivilege):reserve(c,d,'invoice_attachment',d['foreign'])
        c.rollback();user(c,d,actor=str(uuid4()))
        with pytest.raises(psycopg.errors.InsufficientPrivilege):reserve(c,d)
        c.rollback();c.execute("UPDATE public.memberships SET role='viewer'");c.commit();user(c,d)
        with pytest.raises(psycopg.errors.InsufficientPrivilege):reserve(c,d)
        c.rollback();c.execute("UPDATE public.memberships SET role='editor'");c.commit();user(c,d)
        with pytest.raises(psycopg.errors.InsufficientPrivilege):reserve(c,d)
        c.rollback();user(c,d);row=reserve(c,d,'invoice_attachment',d['invoice']);assert row['resource_id']==d['invoice']
        row=reserve(c,d,'receipt',d['receipt']);assert row['resource_id']==d['receipt']

def test_quarantine_direct_write_overwrite_and_delete_denied(uploads_db):
    d=uploads_db
    with psycopg.connect(DSN) as c:
        assert c.execute('SELECT count(*) FROM storage.objects').fetchone()[0]==1
        assert c.execute('SELECT bool_and(NOT public) FROM storage.buckets').fetchone()[0]
        user(c,d)
        assert c.execute('SELECT count(*) FROM storage.objects').fetchone()[0]==0
        for bucket in ['business-assets','business-logos','business-documents','cacu-quarantine','cacu-approved']:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):c.execute('INSERT INTO storage.objects(bucket_id,name) VALUES(%s,%s)',(bucket,d['business']+'/evil.png'))
            c.rollback();user(c,d)
        assert c.execute("UPDATE storage.objects SET name='overwrite.png' RETURNING id").fetchall()==[]
        assert c.execute('DELETE FROM storage.objects RETURNING id').fetchall()==[]
        c.rollback();user(c,d,role='service_role');c.execute("INSERT INTO storage.objects(bucket_id,name) VALUES('cacu-approved',%s)",(d['business']+'/server-file.png',))

def test_quota_reserved_atomically_and_pending_read_denied(uploads_db):
    d=uploads_db
    with psycopg.connect(DSN) as c:
        user(c,d)
        for _ in range(9):reserve(c,d)
        assert c.execute('SELECT count(*) FROM public.upload_records').fetchone()[0]==0
    def attempt():
        try:
            with psycopg.connect(DSN) as c:user(c,d);reserve(c,d)
            return True
        except psycopg.errors.RaiseException:return False
    with ThreadPoolExecutor(max_workers=2) as pool:assert sorted(pool.map(lambda _:attempt(),range(2)))==[False,True]

def test_approved_metadata_tenant_read_and_server_promotion_only(uploads_db):
    d=uploads_db
    with psycopg.connect(DSN) as c:
        user(c,d);row=reserve(c,d)
        with pytest.raises(psycopg.errors.InsufficientPrivilege):c.execute('SELECT public.approve_upload(%s,%s,%s,%s,%s)',(row['id'],'png','image/png',100,'a'*64))
        c.rollback();user(c,d);row=reserve(c,d);approved=approve(c,row);assert approved['object_path'].endswith(row['id']+'.png');c.commit()
        user(c,d);assert len(c.execute('SELECT * FROM public.upload_records').fetchall())==1
        with pytest.raises(psycopg.errors.InsufficientPrivilege):c.execute("UPDATE public.upload_records SET state='approved'")
        c.rollback();user(c,d,actor=str(uuid4()));assert c.execute('SELECT * FROM public.upload_records').fetchall()==[]

def test_revoked_membership_blocks_promotion_and_authorized_delete(uploads_db):
    d=uploads_db
    with psycopg.connect(DSN) as c:
        user(c,d);row=reserve(c,d);c.commit()
        c.execute("UPDATE public.memberships SET role='viewer'");c.commit();user(c,d,role='service_role')
        with pytest.raises(psycopg.errors.InsufficientPrivilege):approve(c,row)
        c.rollback();c.execute("UPDATE public.memberships SET role='owner'");approved=approve(c,row);c.commit()
        c.execute("UPDATE public.memberships SET role='viewer'");c.commit();user(c,d)
        with pytest.raises(psycopg.errors.InsufficientPrivilege):c.execute('SELECT public.request_upload_delete(%s,%s)',(d['business'],row['id']))
        c.rollback();c.execute("UPDATE public.memberships SET role='owner'");c.commit();user(c,d)
        c.execute('SELECT public.request_upload_delete(%s,%s)',(d['business'],row['id']))
        assert c.execute('SELECT * FROM public.upload_records').fetchall()==[]
        user(c,d,role='service_role');c.execute("SELECT public.finish_upload_cleanup(%s,'deleted')",(row['id'],))
        assert c.execute('SELECT reserved_bytes FROM public.upload_records WHERE id=%s',(row['id'],)).fetchone()[0]==0

def test_orphan_cleanup_excludes_approved_and_historical_files(uploads_db):
    d=uploads_db
    with psycopg.connect(DSN) as c:
        user(c,d);old=reserve(c,d);new=reserve(c,d);good=reserve(c,d);approve(c,good);c.commit()
        c.execute("UPDATE public.upload_records SET updated_at=now()-interval '2 hours' WHERE id IN (%s,%s)",(old['id'],good['id']));c.commit()
        user(c,d,role='service_role');claimed=c.execute('SELECT id FROM public.claim_upload_orphans()').fetchall()
        assert claimed==[(UUID(old['id']),)]
        assert c.execute('SELECT count(*) FROM storage.objects').fetchone()[0]==1

from uuid import UUID


def test_storage_byte_quota_and_invalid_names(uploads_db):
    d=uploads_db
    with psycopg.connect(DSN) as c:
        user(c,d)
        with pytest.raises(psycopg.errors.CheckViolation):reserve(c,d,name='../evil.png')
        c.rollback()
        for _ in range(25):
            user(c,d);row=reserve(c,d);approve(c,row,2097152);c.commit()
        user(c,d)
        with pytest.raises(psycopg.errors.RaiseException):reserve(c,d)
        c.rollback()


def test_prepared_object_path_survives_crash_and_is_claimed(uploads_db):
    d=uploads_db
    with psycopg.connect(DSN) as c:
        user(c,d);row=reserve(c,d);user(c,d,role='service_role')
        prepared=c.execute('SELECT public.prepare_upload(%s,%s,%s,%s,%s)',(row['id'],'png','image/png',100,'a'*64)).fetchone()[0]
        assert prepared['object_path'].endswith(row['id']+'.png') and prepared['state']=='pending'
        c.commit();c.execute("UPDATE public.upload_records SET updated_at=now()-interval '2 hours'");c.commit()
        user(c,d,role='service_role');assert c.execute('SELECT object_path FROM public.claim_upload_orphans()').fetchone()[0]==prepared['object_path']


def test_deleted_resource_managed_file_is_an_orphan(uploads_db):
    d=uploads_db
    with psycopg.connect(DSN) as c:
        user(c,d);row=reserve(c,d,'invoice_attachment',d['invoice']);approve(c,row);c.commit()
        c.execute('DELETE FROM public.invoices WHERE id=%s',(d['invoice'],))
        c.execute("UPDATE public.upload_records SET updated_at=now()-interval '2 hours'");c.commit()
        user(c,d);assert c.execute('SELECT * FROM public.upload_records').fetchall()==[]
        user(c,d,role='service_role');assert c.execute('SELECT id FROM public.claim_upload_orphans()').fetchone()[0]==UUID(row['id'])


def test_service_can_compensate_lost_promotion_response(uploads_db):
    d=uploads_db
    with psycopg.connect(DSN) as c:
        user(c,d);row=reserve(c,d);approve(c,row);c.commit();user(c,d,role='service_role')
        c.execute("SELECT public.finish_upload_cleanup(%s,'cleanup_required')",(row['id'],))
        assert c.execute('SELECT state,reserved_bytes FROM public.upload_records WHERE id=%s',(row['id'],)).fetchone()==('cleanup_required',100)
