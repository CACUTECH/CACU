"""Permission model, part 3: choosing or changing the plan, cancelling and the saved card are Owner-only (billing.edit);
admins still see billing and pay a due renewal (Doc 08 §5)."""
import json
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.billing import service
from cacu.billing.service import Checkout
from test_platform_billing_postgres import database, gateway, business, MIGRATIONS, URL  # noqa: F401  (fixtures)

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


@pytest.fixture
def switched(database):
    with psycopg.connect(URL) as c:
        c.execute('DROP SCHEMA IF EXISTS authz CASCADE')
        for name in ('20261106100000_authz_foundation.sql', '20261106110000_permissions_sales_invoices_expenses.sql',
                     '20261106120000_permissions_ledger_hr_settings_billing.sql'):
            c.execute((MIGRATIONS / name).read_text(encoding='utf-8'))
    ident, owner, editor = business()
    admin = uuid4()
    with psycopg.connect(URL) as c:
        c.execute("INSERT INTO memberships(business_id,user_id,role) VALUES(%s,%s,'admin')", (ident, admin))
    return ident, owner, admin, editor


def as_user(c, person):
    c.execute('SET LOCAL ROLE authenticated')
    c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': str(person)}),))


def test_only_the_owner_chooses_the_plan(gateway, switched):
    ident, owner, admin, editor = switched
    for person in (admin, editor):
        with pytest.raises(HTTPException) as refused:
            service.checkout(ident, person, Checkout(request_key=uuid4(), plan='GROW'))
        assert refused.value.status_code == 403
    assert gateway.initialized == []
    with pytest.raises(HTTPException) as refused:
        service.checkout(ident, admin, Checkout(request_key=uuid4(), plan='GROW'))
    assert refused.value.detail == 'Only the business owner can choose or change the plan'
    assert service.checkout(ident, owner, Checkout(request_key=uuid4(), plan='GROW'))['authorization_url']


def test_admins_see_billing_and_may_pay_a_renewal_but_not_cancel_or_remove_the_card(switched):
    ident, owner, admin, editor = switched
    with psycopg.connect(URL) as c:
        as_user(c, admin)
        assert c.execute('SELECT public.business_billing_history(%s)', (ident,)).fetchone()[0] is not None
    for call in ('SELECT public.remove_payment_method(%s)', 'SELECT public.cancel_subscription(%s, true)'):
        with psycopg.connect(URL) as c:
            as_user(c, admin)
            with pytest.raises(psycopg.errors.InsufficientPrivilege, match='PERMISSION_DENIED billing.edit'):
                c.execute(call, (ident,))
    with pytest.raises(HTTPException) as refused:  # past the permission check: there is simply nothing due
        service.renewal_checkout(ident, admin)
    assert refused.value.status_code == 409
    with pytest.raises(HTTPException) as refused:
        service.renewal_checkout(ident, editor)
    assert refused.value.status_code == 403
