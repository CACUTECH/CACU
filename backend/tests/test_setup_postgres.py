"""Real PostgreSQL setup transaction and privilege regression tests.
Run only against a dedicated loopback database named *_test.
"""
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4
import psycopg
from psycopg.types.json import Jsonb
import pytest

URL = os.getenv("CACU_SETUP_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Dedicated setup test database required")
DETAILS = dict(name="Test business", type="HYBRID", sector="Retail", address="Test", email="test@example.com", phone="1", bank_name="Test", account_number="123", account_name="Test")

@pytest.fixture(autouse=True)
def database():
    parsed = urlparse(URL)
    assert parsed.hostname in {"127.0.0.1", "localhost"} and parsed.path.endswith("_test")
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute("DROP SCHEMA IF EXISTS onboarding_private CASCADE; DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS auth CASCADE; CREATE SCHEMA public; CREATE SCHEMA auth")
        for role in ("anon", "authenticated"):
            if not c.execute("SELECT 1 FROM pg_roles WHERE rolname=%s", (role,)).fetchone():
                c.execute(psycopg.sql.SQL("CREATE ROLE {} NOLOGIN").format(psycopg.sql.Identifier(role)))
        c.execute("""
        CREATE TABLE auth.users(id uuid PRIMARY KEY);
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
        GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
        GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
        CREATE TABLE public.businesses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,business_type text NOT NULL CHECK(business_type IN ('PRODUCT','SERVICE','HYBRID')),sector text,address text,email text,phone_number text,bank_name text,bank_account_number text,bank_account_name text,created_by uuid NOT NULL REFERENCES auth.users(id));
        CREATE TABLE public.memberships(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES auth.users(id),role text NOT NULL,UNIQUE(business_id,user_id));
        CREATE FUNCTION public.handle_new_business() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN INSERT INTO public.memberships(business_id,user_id,role) VALUES(new.id,new.created_by,'owner'); RETURN new; END $$;
        CREATE TRIGGER businesses_create_owner_membership AFTER INSERT ON public.businesses FOR EACH ROW EXECUTE FUNCTION public.handle_new_business();
        ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
        GRANT ALL ON public.businesses TO authenticated, anon;
        GRANT INSERT(name) ON public.businesses TO authenticated;
        """)
        migration = Path(__file__).resolve().parents[2] / "supabase/migrations/20261011143320_atomic_business_setup.sql"
        c.execute(migration.read_text(encoding="utf-8"))
    yield


def user():
    actor = uuid4()
    with psycopg.connect(URL) as c:
        c.execute("INSERT INTO auth.users VALUES(%s)", (actor,))
    return actor


def create(actor, key, details=None):
    with psycopg.connect(URL) as c:
        c.execute("SET LOCAL ROLE authenticated")
        c.execute("SELECT set_config('request.jwt.claim.sub',%s,true)", (str(actor),))
        return c.execute("SELECT public.create_business_safe(%s,%s)", (key, Jsonb(details or DETAILS))).fetchone()[0]


def test_atomic_owner_and_retry():
    actor, key = user(), uuid4()
    first = create(actor, key)
    assert first["replayed"] is False
    assert create(actor, key) == dict(id=first["id"], replayed=True)
    with psycopg.connect(URL) as c:
        assert c.execute("SELECT count(*) FROM public.businesses").fetchone()[0] == 1
        assert c.execute("SELECT role FROM public.memberships WHERE user_id=%s", (actor,)).fetchone()[0] == "owner"
        assert c.execute("SELECT count(*) FROM onboarding_private.business_requests").fetchone()[0] == 1


def test_changed_payload_and_existing_membership_rejected():
    actor, key = user(), uuid4()
    create(actor, key)
    with pytest.raises(psycopg.errors.InvalidParameterValue):
        create(actor, key, dict(DETAILS, name="Changed"))
    with pytest.raises(psycopg.errors.RaiseException, match="already registered"):
        create(actor, uuid4())


def test_owner_trigger_missing_rolls_back_everything():
    actor = user()
    with psycopg.connect(URL) as c:
        c.execute("DROP TRIGGER businesses_create_owner_membership ON public.businesses")
    with pytest.raises(psycopg.errors.RaiseException, match="Owner membership"):
        create(actor, uuid4())
    with psycopg.connect(URL) as c:
        for table in ("public.businesses", "public.memberships", "onboarding_private.business_requests"):
            assert c.execute(psycopg.sql.SQL("SELECT count(*) FROM {}").format(psycopg.sql.SQL(table))).fetchone()[0] == 0


def test_revoked_membership_cannot_replay():
    actor, key = user(), uuid4()
    create(actor, key)
    with psycopg.connect(URL) as c:
        c.execute("DELETE FROM public.memberships WHERE user_id=%s", (actor,))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        create(actor, key)


@pytest.mark.parametrize("same_key", [True, False])
def test_concurrent_requests(same_key):
    actor, key = user(), uuid4()
    def attempt(request_key):
        try:
            return create(actor, request_key)
        except psycopg.errors.RaiseException as exc:
            assert "already registered" in str(exc)
            return None
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, [key, key if same_key else uuid4()]))
    if same_key:
        assert results[0]["id"] == results[1]["id"]
        assert sorted(x["replayed"] for x in results) == [False, True]
    else:
        assert sum(x is not None for x in results) == 1
    with psycopg.connect(URL) as c:
        assert c.execute("SELECT count(*) FROM public.businesses").fetchone()[0] == 1


def test_foreign_actor_key_cannot_access_original():
    key = uuid4()
    first = create(user(), key)
    second = create(user(), key)
    assert first["id"] != second["id"]


@pytest.mark.parametrize("details", [dict(DETAILS, created_by=str(uuid4())), dict(DETAILS, name=" "), dict(DETAILS, type="PAID"), dict(DETAILS, account_name=None)])
def test_invalid_details_rejected(details):
    with pytest.raises(psycopg.errors.InvalidParameterValue):
        create(user(), uuid4(), details)


def test_browser_privileges():
    with psycopg.connect(URL) as c:
        for role in ("anon", "authenticated"):
            for privilege in ("INSERT", "TRUNCATE", "TRIGGER", "REFERENCES"):
                assert not c.execute("SELECT has_table_privilege(%s,'public.businesses',%s)", (role, privilege)).fetchone()[0]
            assert not c.execute("SELECT has_any_column_privilege(%s,'public.businesses','INSERT')", (role,)).fetchone()[0]
            assert not c.execute("SELECT has_table_privilege(%s,'onboarding_private.business_requests','SELECT')", (role,)).fetchone()[0]
        assert not c.execute("SELECT has_function_privilege('anon','public.create_business_safe(uuid,jsonb)','EXECUTE')").fetchone()[0]
        c.execute("SET LOCAL ROLE authenticated")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            c.execute("SELECT public.create_business_safe(%s,%s)", (uuid4(),Jsonb(DETAILS)))
