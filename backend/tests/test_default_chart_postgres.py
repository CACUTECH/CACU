"""Default chart of accounts (Doc 09 section 4, ACC-012, FR-131) on disposable PostgreSQL fixtures."""
from pathlib import Path
from uuid import uuid4
import psycopg
import pytest
from cacu.accounting.chart import build_mapping, validate
from test_management_postgres import managed, database, URL
from test_legacy_write_boundary_postgres import boundary, run

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


@pytest.fixture
def charted(boundary):
    d, legacy, other, people = boundary
    service = uuid4()
    with psycopg.connect(URL) as c:
        # Mirror hosted columns used by the chart.
        c.execute("""ALTER TABLE public.accounts ADD COLUMN code text, ADD COLUMN account_type text,
            ALTER COLUMN id SET DEFAULT gen_random_uuid(), ADD CONSTRAINT accounts_business_id_code_key UNIQUE (business_id, code);
          ALTER TABLE public.businesses ADD COLUMN business_type text NOT NULL DEFAULT 'PRODUCT';
          DROP SCHEMA IF EXISTS onboarding_private CASCADE; CREATE SCHEMA onboarding_private""")
        c.execute("INSERT INTO businesses(id,name,business_type) VALUES(%s,'Salon','SERVICE')", (service,))
        c.execute("INSERT INTO memberships(business_id,user_id,role,is_active) VALUES(%s,%s,'owner',true)", (service, people['owner']))
        c.execute(Path('../supabase/migrations/20261031100000_default_chart_of_accounts.sql').read_text(encoding='utf-8'))
    return d, legacy, other, service, people


def adopt(business, actor, key=None):
    return run(actor, 'SELECT public.adopt_default_chart(%s,%s)', (business, key or uuid4()))[0][0]


def chart(business, actor):
    return run(actor, 'SELECT public.chart_of_accounts(%s)', (business,))[0][0]


def test_owner_adopts_product_chart_once_with_audit(charted):
    _, legacy, _, _, people = charted
    first = adopt(legacy, people['owner'])
    again = adopt(legacy, people['owner'])
    assert first == {'version': 'NG-2026.1', 'mode': 'PRODUCT', 'accounts': 28, 'replayed': False}
    assert again['replayed'] is True and again['accounts'] == 28
    with psycopg.connect(URL) as c:
        codes = [r[0] for r in c.execute('SELECT code FROM accounts WHERE business_id=%s ORDER BY code', (legacy,))]
        assert codes[:5] == ['1000', '1010', '1020', '1100', '1200'] and len(codes) == len(set(codes)) == 28
        assert c.execute("SELECT count(*) FROM audit_logs WHERE business_id=%s AND action='CHART_ADOPTED'", (legacy,)).fetchone() == (1,)


def test_service_chart_has_no_stock_accounts_and_posts_sales_to_service_income(charted):
    _, _, _, service, people = charted
    assert adopt(service, people['owner'])['accounts'] == 24
    accounts = {a['code']: a for a in chart(service, people['owner'])['accounts']}
    assert not {'1200', '4000', '5000', '5100'} & set(accounts)
    assert accounts['4100']['purpose'] == 'revenue' and accounts['1000']['purpose'] == 'cash'


@pytest.mark.parametrize('role', ['editor', 'viewer', 'outsider'])
def test_only_owners_and_admins_adopt(charted, role):
    _, legacy, _, _, people = charted
    with pytest.raises(psycopg.Error, match='ACCESS_DENIED'):
        adopt(legacy, people[role])


def test_businesses_with_books_or_accounts_are_refused(charted):
    d, legacy, _, _, people = charted
    with pytest.raises(psycopg.Error, match='BOOKS_ALREADY_SET_UP'):
        adopt(d[1], d[2])
    with psycopg.connect(URL) as c:
        c.execute("INSERT INTO accounts(business_id,code,name,account_type) VALUES(%s,'9999','Own account','asset')", (legacy,))
    with pytest.raises(psycopg.Error, match='CHART_EXISTS'):
        adopt(legacy, people['owner'])


def test_members_read_the_chart_with_review_status_and_outsiders_cannot(charted):
    _, legacy, _, _, people = charted
    assert chart(legacy, people['viewer']) == {'template': None, 'books_active': False, 'accounts': []}
    adopt(legacy, people['owner'])
    read = chart(legacy, people['viewer'])
    assert read['template']['version'] == 'NG-2026.1' and read['template']['status'] == 'pending_review'
    assert {a['code']: a['purpose'] for a in read['accounts']}['3900'] == 'equity'
    with pytest.raises(psycopg.Error, match='ACCESS_DENIED'):
        chart(legacy, people['outsider'])


def test_template_is_private_and_satisfies_provisioning_rules_for_every_mode(charted):
    _, legacy, _, _, people = charted
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        run(people['owner'], 'SELECT count(*) FROM onboarding_private.chart_template_accounts')
    with psycopg.connect(URL) as c:
        for mode in ['PRODUCT', 'SERVICE', 'HYBRID']:
            rows = c.execute("""SELECT code, library_type, flow_section, purpose FROM onboarding_private.chart_template_accounts
                WHERE version = 'NG-2026.1' AND mode = %s""", (mode,)).fetchall()
            validate(mode, [{'id': code, 'code': code, 'account_type': kind, 'flow_section': flow, 'purpose': purpose}
                            for code, kind, flow, purpose in rows])


def test_mapping_refuses_unreviewed_template_and_builds_a_valid_mapping_for_staging(charted):
    _, legacy, _, _, people = charted
    adopt(legacy, people['owner'])
    customer = uuid4()
    with psycopg.connect(URL) as c:
        c.execute('INSERT INTO customers(id,business_id,name) VALUES(%s,%s,%s)', (customer, legacy, 'Ada'))
        with pytest.raises(ValueError, match='awaiting accountant review'):
            build_mapping(c, legacy)
        mapping = build_mapping(c, legacy, allow_unreviewed=True)
        receivables = c.execute("SELECT id FROM accounts WHERE business_id=%s AND code='1100'", (legacy,)).fetchone()[0]
    assert len(mapping['accounts']) == 28 and mapping['template'] == 'NG-2026.1'
    assert {a['purpose'] for a in mapping['accounts']} >= {'cash', 'bank', 'revenue', 'equity', 'inventory', 'cogs', 'other'}
    assert mapping['parties'] == [{'type': 'customers', 'id': str(customer), 'account_id': str(receivables)}]


@pytest.mark.parametrize('change,error', [('drop_cash', 'missing'), ('second_revenue', 'duplicated'), ('cash_not_bank', 'BANK type')])
def test_validation_catches_unpostable_charts(change, error):
    accounts = [{'id': '1', 'code': '1000', 'account_type': 'BANK', 'flow_section': 'cash', 'purpose': 'cash'},
                {'id': '2', 'code': '3900', 'account_type': 'EQUITY', 'flow_section': 'financing', 'purpose': 'equity'},
                {'id': '3', 'code': '4100', 'account_type': 'OPERATING_REVENUE', 'flow_section': 'operating', 'purpose': 'revenue'}]
    if change == 'drop_cash':
        accounts = accounts[1:]
    elif change == 'second_revenue':
        accounts.append({'id': '4', 'code': '4000', 'account_type': 'OPERATING_REVENUE', 'flow_section': 'operating', 'purpose': 'revenue'})
    else:
        accounts[0]['account_type'] = 'CURRENT_ASSET'
    with pytest.raises(ValueError, match=error):
        validate('SERVICE', accounts)
