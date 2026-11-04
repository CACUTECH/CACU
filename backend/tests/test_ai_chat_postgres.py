"""Shared AI request boundaries on a separate disposable loopback database."""
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4
import psycopg
import pytest

URL = os.getenv('CACU_AI_TEST_DATABASE_URL')
pytestmark = pytest.mark.skipif(not URL, reason='Dedicated AI test database required')
MODEL = 'test-approved-model'
FINGERPRINT = 'a' * 64

@pytest.fixture(autouse=True)
def database():
    parsed = urlparse(URL)
    assert parsed.hostname in {'127.0.0.1','localhost'} and parsed.path.endswith('_test')
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute('DROP SCHEMA IF EXISTS ai_private CASCADE; DROP SCHEMA IF EXISTS platform CASCADE; DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS auth CASCADE; CREATE SCHEMA public; CREATE SCHEMA auth')
        for role in ('anon','authenticated'):
            if not c.execute('SELECT 1 FROM pg_roles WHERE rolname=%s',(role,)).fetchone():
                c.execute(psycopg.sql.SQL('CREATE ROLE {} NOLOGIN').format(psycopg.sql.Identifier(role)))
        c.execute("""CREATE TABLE auth.users(id uuid PRIMARY KEY);
        CREATE TABLE public.businesses(id uuid PRIMARY KEY,business_type text NOT NULL DEFAULT 'PRODUCT');
        CREATE TABLE public.memberships(user_id uuid NOT NULL,business_id uuid NOT NULL REFERENCES public.businesses(id),role text NOT NULL,is_active boolean NOT NULL DEFAULT true,PRIMARY KEY(user_id,business_id));
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
        GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
        GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
        ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;""")
        for name in ('20261012132427_guarded_ai_chat.sql','20261102090100_ai_active_members.sql','20261102100000_platform_plans.sql','20261104090000_ai_plan_quota.sql','20261104130000_plan_limit_values.sql'):
            c.execute((Path(__file__).resolve().parents[2]/'supabase/migrations'/name).read_text(encoding='utf-8'))
    yield

def member(business=None,role='owner'):
    actor,business = uuid4(),business or uuid4()
    with psycopg.connect(URL) as c:
        c.execute('INSERT INTO auth.users VALUES(%s)',(actor,))
        c.execute('INSERT INTO public.businesses VALUES(%s) ON CONFLICT DO NOTHING',(business,))
        c.execute('INSERT INTO public.memberships(user_id,business_id,role) VALUES(%s,%s,%s)',(actor,business,role))
    return actor,business

def enable(**limits):
    with psycopg.connect(URL) as c:
        c.execute('UPDATE ai_private.settings SET enabled=true,allowed_model=%s',(MODEL,))
        for key,value in limits.items():
            assert key in {'actor_per_minute','actor_per_day','business_per_day','global_per_day'}
            c.execute(psycopg.sql.SQL('UPDATE ai_private.settings SET {}=%s').format(psycopg.sql.Identifier(key)),(value,))

def rpc(actor,name,args,role='authenticated'):
    with psycopg.connect(URL) as c:
        c.execute(psycopg.sql.SQL('SET LOCAL ROLE {}').format(psycopg.sql.Identifier(role)))
        c.execute("SELECT set_config('request.jwt.claim.sub',%s,true)",(str(actor) if actor else '',))
        placeholders=psycopg.sql.SQL(',').join(psycopg.sql.Placeholder() for _ in args)
        return c.execute(psycopg.sql.SQL('SELECT public.{}({})').format(psycopg.sql.Identifier(name),placeholders),args).fetchone()[0]

def reserve(actor,business,key=None,fingerprint=FINGERPRINT,model=MODEL):
    return rpc(actor,'reserve_ai_chat',(business,key or uuid4(),fingerprint,model))

def test_defaults_disabled_and_model_bound():
    actor,business=member()
    assert rpc(actor,'get_ai_chat_status',(business,MODEL)) is False
    with pytest.raises(psycopg.errors.RaiseException,match='AI_DISABLED'): reserve(actor,business)
    enable()
    assert rpc(actor,'get_ai_chat_status',(business,MODEL)) is True
    with pytest.raises(psycopg.errors.RaiseException,match='AI_DISABLED'): reserve(actor,business,model='unapproved')

def test_stable_key_only_reserves_once_and_changed_payload_rejected():
    actor,business=member(); enable(); key=uuid4()
    assert reserve(actor,business,key)['reserved'] is True
    assert reserve(actor,business,key)==dict(reserved=False,status='reserved')
    with pytest.raises(psycopg.errors.InvalidParameterValue,match='AI_RETRY_CHANGED'):
        reserve(actor,business,key,'b'*64)
    assert rpc(actor,'finish_ai_chat',(business,key,'completed')) is True
    assert reserve(actor,business,key)==dict(reserved=False,status='completed')
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT count(*) FROM ai_private.requests').fetchone()[0]==1

@pytest.mark.parametrize('same_key',[True,False])
def test_concurrent_shared_limit(same_key):
    actor,business=member(); enable(global_per_day=1); key=uuid4()
    def attempt(request_key):
        try: return reserve(actor,business,request_key)
        except psycopg.errors.RaiseException as exc:
            assert 'AI_RATE_LIMIT' in str(exc); return None
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(attempt,[key,key if same_key else uuid4()]))
    assert sum(result is not None and result['reserved'] for result in results)==1
    if same_key: assert sum(result is not None for result in results)==2

@pytest.mark.parametrize('limit',['actor_per_minute','actor_per_day','business_per_day','global_per_day'])
def test_each_shared_cap(limit):
    actor,business=member(); enable(**{limit:1}); key=uuid4(); reserve(actor,business,key)
    rpc(actor,'finish_ai_chat',(business,key,'failed'))
    if limit=='business_per_day': actor,_=member(business)
    if limit=='global_per_day': actor,business=member()
    with pytest.raises(psycopg.errors.RaiseException,match='AI_RATE_LIMIT'): reserve(actor,business)

def test_capacity_resumes_after_rolling_window():
    actor,business=member(); enable(actor_per_day=1); reserve(actor,business)
    with psycopg.connect(URL) as c:
        c.execute("UPDATE ai_private.requests SET created_at=now()-interval '25 hours'")
    assert reserve(actor,business)['reserved'] is True

def test_foreign_revoked_and_anonymous_access():
    actor,business=member(); other,_=member(); enable(); key=uuid4(); reserve(actor,business,key)
    with pytest.raises(psycopg.errors.InsufficientPrivilege): reserve(other,business)
    with pytest.raises(psycopg.errors.InsufficientPrivilege): rpc(None,'reserve_ai_chat',(business,uuid4(),FINGERPRINT,MODEL),'anon')
    with psycopg.connect(URL) as c: c.execute('DELETE FROM public.memberships WHERE user_id=%s',(actor,))
    with pytest.raises(psycopg.errors.InsufficientPrivilege): rpc(actor,'finish_ai_chat',(business,key,'completed'))
    with pytest.raises(psycopg.errors.InsufficientPrivilege): reserve(actor,business,key)

def test_other_actor_cannot_finish_known_key_and_table_grants_denied():
    actor,business=member(); other,_=member(business); enable(); key=uuid4(); reserve(actor,business,key)
    assert rpc(other,'finish_ai_chat',(business,key,'completed')) is False
    with psycopg.connect(URL) as c:
        for role in ('anon','authenticated'):
            for table in ('settings','requests'):
                for privilege in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE'):
                    assert not c.execute('SELECT has_table_privilege(%s,%s,%s)',(role,'ai_private.'+table,privilege)).fetchone()[0]
        rows=c.execute("SELECT relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ai_private' AND c.relkind='r'").fetchall()
        assert len(rows)==2 and all(all(row) for row in rows)

def test_deleting_membership_or_business_does_not_refund_global_capacity():
    actor,business=member(); enable(global_per_day=1); reserve(actor,business)
    with psycopg.connect(URL) as c:
        c.execute('DELETE FROM public.memberships WHERE business_id=%s',(business,))
        c.execute('DELETE FROM public.businesses WHERE id=%s',(business,))
    actor,business=member()
    with pytest.raises(psycopg.errors.RaiseException,match='AI_RATE_LIMIT'): reserve(actor,business)

def test_shutdown_after_reservation_prevents_completion():
    actor,business=member(); enable(); key=uuid4(); reserve(actor,business,key)
    with psycopg.connect(URL) as c: c.execute('UPDATE ai_private.settings SET enabled=false')
    with pytest.raises(psycopg.errors.RaiseException,match='AI_DISABLED'): rpc(actor,'finish_ai_chat',(business,key,'completed'))
    assert rpc(actor,'finish_ai_chat',(business,key,'failed')) is True

@pytest.mark.parametrize('role',['editor','viewer'])
def test_general_guidance_roles_only_receive_metadata_reservation(role):
    actor,business=member(role=role); enable()
    assert reserve(actor,business)['reserved'] is True


def test_deleted_auth_user_cannot_use_an_old_identity_claim():
    actor,business=member(); enable()
    with psycopg.connect(URL) as c: c.execute('DELETE FROM auth.users WHERE id=%s',(actor,))
    with pytest.raises(psycopg.errors.InsufficientPrivilege): reserve(actor,business)


def test_deactivated_member_cannot_reserve_or_finish():
    actor,business=member(role='editor'); enable(); key=uuid4(); reserve(actor,business,key)
    with psycopg.connect(URL) as c: c.execute('UPDATE public.memberships SET is_active=false WHERE user_id=%s',(actor,))
    with pytest.raises(psycopg.errors.InsufficientPrivilege): reserve(actor,business)
    with pytest.raises(psycopg.errors.InsufficientPrivilege): rpc(actor,'finish_ai_chat',(business,key,'completed'))


def subscribe(business,plan,status='active'):
    with psycopg.connect(URL) as c:
        c.execute("SELECT set_config('platform.actor_kind','system',true),set_config('platform.reason','AI quota test',true)")
        c.execute('INSERT INTO platform.subscriptions(business_id,plan_code,status) VALUES(%s,%s,%s)',(business,plan,status))

def seed_this_month(business,n,status='completed'):
    """n questions from another member earlier this month (Lagos), so per-actor caps are untouched."""
    with psycopg.connect(URL) as c:
        c.execute("""INSERT INTO ai_private.requests(actor_id,request_key,business_id,fingerprint,model,status,created_at)
          SELECT gen_random_uuid(),gen_random_uuid(),%s,%s,%s,%s,(date_trunc('month',now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos')+interval '1 second'
          FROM generate_series(1,%s)""",(business,FINGERPRINT,MODEL,status,n))

def requests(business):
    with psycopg.connect(URL) as c:
        return c.execute('SELECT count(*) FROM ai_private.requests WHERE business_id=%s',(business,)).fetchone()[0]

def test_oga_allows_100_questions_a_month_then_refuses_without_counting():  # TEST-210
    actor,business=member(); enable(business_per_day=200,global_per_day=500); subscribe(business,'GROW')
    seed_this_month(business,98); seed_this_month(business,5,'failed')  # failed answers are not counted
    assert reserve(actor,business)['remaining']==1
    assert reserve(actor,business)['remaining']==0
    before=requests(business)
    with pytest.raises(psycopg.errors.RaiseException,match='AI_MONTHLY_LIMIT'): reserve(actor,business)
    assert requests(business)==before
    quota=rpc(actor,'get_ai_chat_quota',(business,))
    assert (quota['limit'],quota['used'],quota['remaining'],quota['billed'])==(100,100,0,True)

def test_last_months_questions_do_not_count():
    actor,business=member(); enable(business_per_day=200,global_per_day=500); subscribe(business,'GROW')
    seed_this_month(business,100)
    with psycopg.connect(URL) as c: c.execute("UPDATE ai_private.requests SET created_at=created_at-interval '2 seconds'")
    assert reserve(actor,business)['remaining']==99

def test_general_has_30_chairman_is_unlimited_and_suspended_businesses_ask_none():
    actor,business=member(); enable(business_per_day=200,global_per_day=500); subscribe(business,'BASE')
    seed_this_month(business,29)
    assert reserve(actor,business)['remaining']==0
    with pytest.raises(psycopg.errors.RaiseException,match='AI_MONTHLY_LIMIT'): reserve(actor,business)
    assert rpc(actor,'get_ai_chat_quota',(business,))['limit']==30
    actor,business=member(); subscribe(business,'TOP'); seed_this_month(business,150)
    assert reserve(actor,business)['remaining'] is None  # unlimited
    quota=rpc(actor,'get_ai_chat_quota',(business,))
    assert (quota['billed'],quota['limit'],quota['used'])==(True,None,151)
    actor,business=member(); subscribe(business,'TOP','suspended')
    with pytest.raises(psycopg.errors.RaiseException,match='AI_PLAN_SUSPENDED'): reserve(actor,business)
    assert requests(business)==0

def test_unbilled_businesses_keep_the_shared_limits_only_and_quota_is_members_only():
    actor,business=member(); enable()
    assert reserve(actor,business)['remaining'] is None
    quota=rpc(actor,'get_ai_chat_quota',(business,))
    assert (quota['billed'],quota['limit'],quota['used'])==(False,None,1)
    other,_=member()
    with pytest.raises(psycopg.errors.InsufficientPrivilege): rpc(other,'get_ai_chat_quota',(business,))
