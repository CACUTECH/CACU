"""Chart of accounts edits (FR-131): adding, renaming, archiving and restoring accounts, before and after the books go live."""
import json
from decimal import Decimal
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.accounts import AccountCreate, account_create
from cacu.accounting.workflows import bank_accounts, expense_accounts, expense_create
from cacu.accounting.reports import trial_balance
from test_corrections_postgres import live, call, balance, expense, URL
from test_opening_position_postgres import books
from test_default_chart_postgres import charted, adopt, chart
from test_legacy_write_boundary_postgres import boundary, run
from test_management_postgres import managed, database
from test_activation_postgres import TODAY

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


def save(business, actor, operation, account=None, key=None, **data):
    return run(actor, 'SELECT public.save_account(%s,%s,%s,%s,%s::jsonb)', (business, key or uuid4(), operation, account, json.dumps(data)))[0][0]


def account_id(business, code):
    with psycopg.connect(URL) as c:
        return c.execute('SELECT id FROM accounts WHERE business_id=%s AND code=%s', (business, code)).fetchone()[0]


@pytest.fixture
def adopted(charted):
    d, legacy, other, service, people = charted
    adopt(legacy, people['owner'])
    return legacy, people


def test_owner_adds_accounts_numbered_within_their_kind_before_the_books_start(adopted):
    legacy, people = adopted
    key = uuid4()
    fuel = save(legacy, people['owner'], 'add', key=key, kind='expense', name='Generator fuel')
    assert (fuel['code'], fuel['account_type'], fuel['library_type'], fuel['flow_section'], fuel['replayed']) == ('6910', 'expense', 'OPERATING_EXPENSE', 'operating', False)
    assert save(legacy, people['owner'], 'add', key=key, kind='expense', name='Generator fuel')['replayed'] is True  # a retry replays
    bank = save(legacy, people['owner'], 'add', kind='bank', name='GTBank current account')
    assert (bank['code'], bank['purpose'], bank['flow_section']) == ('1021', 'bank', 'cash')
    listed = {a['code']: a for a in chart(legacy, people['viewer'])['accounts']}
    assert listed['6910']['added'] and not listed['6910']['system'] and listed['1000']['system'] and not listed['6100']['system']
    assert listed['1021']['purpose'] == 'bank'
    with psycopg.connect(URL) as c:
        actions = [r[0] for r in c.execute("SELECT action FROM audit_logs WHERE business_id=%s AND action LIKE 'ACCOUNT_%%' ORDER BY created_at", (legacy,))]
    assert actions == ['ACCOUNT_ADDED', 'ACCOUNT_ADDED']


@pytest.mark.parametrize('data, error', [
    ({'kind': 'expense', 'name': 'rent'}, 'DUPLICATE_ACCOUNT_NAME'), ({'kind': 'expense', 'name': '  '}, 'INVALID_NAME'),
    ({'kind': 'receivables', 'name': 'Debtors 2'}, 'INVALID_ACCOUNT_KIND'), ({'name': 'No kind'}, 'INVALID_ACCOUNT_KIND'),
])
def test_invalid_additions_are_refused(adopted, data, error):
    legacy, people = adopted
    with pytest.raises(psycopg.Error, match=error):
        save(legacy, people['owner'], 'add', **data)


@pytest.mark.parametrize('role', ['editor', 'viewer', 'outsider'])
def test_only_owners_and_admins_change_the_chart(adopted, role):
    legacy, people = adopted
    with pytest.raises(psycopg.Error, match='ACCESS_DENIED'):
        save(legacy, people[role], 'rename', account_id(legacy, '6100'), name='Shop rent')


def test_rename_archive_and_restore_before_the_books_start(adopted):
    legacy, people = adopted
    rent = account_id(legacy, '6100')
    assert save(legacy, people['owner'], 'rename', rent, name='Shop rent')['name'] == 'Shop rent'
    with pytest.raises(psycopg.Error, match='DUPLICATE_ACCOUNT_NAME'):
        save(legacy, people['owner'], 'rename', rent, name='MARKETING')
    assert save(legacy, people['owner'], 'archive', rent)['is_active'] is False
    for code in ('1000', '1100', '5100', '3900'):  # system accounts carry a purpose automatic postings depend on
        with pytest.raises(psycopg.Error, match='SYSTEM_ACCOUNT'):
            save(legacy, people['owner'], 'archive', account_id(legacy, code))
    assert save(legacy, people['owner'], 'restore', rent)['is_active'] is True
    with pytest.raises(psycopg.Error, match='ACCOUNT_NOT_FOUND'):
        save(legacy, people['owner'], 'rename', uuid4(), name='Ghost')


def test_needs_an_adopted_chart(charted):
    _, legacy, _, _, people = charted
    with pytest.raises(psycopg.Error, match='CHART_NOT_ADOPTED'):
        save(legacy, people['owner'], 'add', kind='expense', name='Fuel')


def test_account_added_before_go_live_is_in_the_books(books):
    from test_activation_postgres import approved, turn_on
    _, legacy, _, _, people, _ = books
    added = save(legacy, people['owner'], 'add', kind='expense', name='Generator fuel')
    approved(books)
    turn_on(books)
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT flow_section,purpose FROM accounting.account_map WHERE business_id=%s AND account_id=%s', (legacy, added['id'])).fetchone() == ('operating', 'other')


def test_after_go_live_accounts_are_added_through_the_accounting_api(live):
    with pytest.raises(psycopg.Error, match='USE_ACCOUNTING_API'):
        save(live.business, live.people['owner'], 'add', kind='expense', name='Generator fuel')
    data = AccountCreate(request_key=uuid4(), kind='expense', name='Generator fuel')
    with pytest.raises(HTTPException, match='Owner or Admin'):
        call(live, 'editor', lambda s, a: account_create(s, a, data))
    added = call(live, 'admin', lambda s, a: account_create(s, a, data))
    assert call(live, 'admin', lambda s, a: account_create(s, a, data))['id'] == added['id']  # a retry makes no second ledger account
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT count(*) FROM accounting.account WHERE business_id=%s AND lower(name)=lower(%s)', (live.business, 'Generator fuel')).fetchone() == (1,)
    assert added['code'] in [a['code'] for a in call(live, 'editor', lambda s, a: expense_accounts(s))]
    live.codes['6910'] = added['id']
    call(live, 'owner', lambda s, a: expense_create(s, a, expense(live, '6910', '7000')))
    assert balance(live, '6910') == Decimal('7000')
    bank = call(live, 'owner', lambda s, a: account_create(s, a, AccountCreate(request_key=uuid4(), kind='bank', name='GTBank')))
    assert {'id': bank['id'], 'name': 'GTBank'} in call(live, 'editor', lambda s, a: bank_accounts(s))


def test_after_go_live_rename_follows_into_reports_and_archive_needs_a_zero_balance(live):
    rent = live.codes['6100']
    save(live.business, live.people['owner'], 'rename', rent, name='Shop rent')
    call(live, 'owner', lambda s, a: expense_create(s, a, expense(live, '6100', '1000')))
    lines = {l['code']: l['name'] for l in call(live, 'viewer', lambda s, a: trial_balance(s, TODAY))['lines']}
    assert lines['6100'] == 'Shop rent'
    with pytest.raises(psycopg.Error, match='ACCOUNT_HAS_BALANCE'):
        save(live.business, live.people['owner'], 'archive', rent)
    marketing = live.codes['6500']
    assert save(live.business, live.people['owner'], 'archive', marketing)['is_active'] is False
    assert '6500' not in [a['code'] for a in call(live, 'owner', lambda s, a: expense_accounts(s))]
    with pytest.raises(HTTPException, match='expense account'):
        call(live, 'owner', lambda s, a: expense_create(s, a, expense(live, '6500', '10')))


def test_map_custom_account_only_links_an_added_account_to_a_matching_ledger_account(live):
    added = call(live, 'owner', lambda s, a: account_create(s, a, AccountCreate(request_key=uuid4(), kind='expense', name='Generator fuel')))
    with psycopg.connect(URL) as c:
        library = dict(c.execute('SELECT account_id::text,library_id FROM accounting.account_map WHERE business_id=%s', (live.business,)).fetchall())
    link = lambda source, target: call(live, 'owner', lambda s, a: s.connection().exec_driver_sql(
        'SELECT accounting.map_custom_account(%s,%s,%s)', (str(live.business), str(source), target)).scalar())
    with pytest.raises(Exception, match='ADDED_ACCOUNT_REQUIRED'):
        link(live.codes['6100'], library[str(live.codes['1000'])])
    with pytest.raises(Exception, match='ACCOUNT_ALREADY_MAPPED'):
        link(added['id'], library[str(live.codes['1000'])])
    with pytest.raises(Exception, match='Owner or Admin'):
        call(live, 'editor', lambda s, a: s.connection().exec_driver_sql('SELECT accounting.map_custom_account(%s,%s,%s)',
                                                                         (str(live.business), added['id'], 1)).scalar())
