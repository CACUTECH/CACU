"""Start your books: opening position (FR-012, PR-01, ACC-016) on disposable PostgreSQL fixtures."""
import json
from decimal import Decimal
from pathlib import Path
from uuid import uuid4
import psycopg
import pytest
from test_management_postgres import managed, database, URL
from test_legacy_write_boundary_postgres import boundary, run
from test_default_chart_postgres import charted, adopt

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


@pytest.fixture
def books(charted):
    d, legacy, other, service, people = charted
    ada, bisi, supplier, foreign_customer = uuid4(), uuid4(), uuid4(), uuid4()
    with psycopg.connect(URL) as c:
        c.execute('INSERT INTO customers(id,business_id,name) VALUES(%s,%s,%s),(%s,%s,%s),(%s,%s,%s)',
                  (ada, legacy, 'Ada Stores', bisi, legacy, 'Bisi', foreign_customer, other, 'Other'))
        c.execute('INSERT INTO suppliers(id,business_id,name) VALUES(%s,%s,%s)', (supplier, legacy, 'Mills Ltd'))
        c.execute('ALTER TABLE public.catalog_items DISABLE TRIGGER USER')
        # Tracked products count; services, untracked, archived and negative stock do not.
        c.execute("""INSERT INTO catalog_items(id,business_id,name,item_type,stock_quantity,cost_price,unit_price,is_active,track_stock) VALUES
            (%s,%s,'Rice','PRODUCT',10,50000,65000,true,true),(%s,%s,'Beans','PRODUCT',3,1200.50,1500,true,true),
            (%s,%s,'Untracked','PRODUCT',5,100,200,true,false),(%s,%s,'Archived','PRODUCT',5,100,200,false,true),
            (%s,%s,'Short','PRODUCT',-2,100,200,true,true),(%s,%s,'Delivery','SERVICE',0,0,500,true,true)""",
                  tuple(x for _ in range(6) for x in (uuid4(), legacy)))
        c.execute('ALTER TABLE public.catalog_items ENABLE TRIGGER USER')
        c.execute(Path('../supabase/migrations/20261031110000_opening_position.sql').read_text(encoding='utf-8'))
    adopt(legacy, people['owner'])
    with psycopg.connect(URL) as c:
        bank = c.execute("SELECT id FROM accounts WHERE business_id=%s AND code='1010'", (legacy,)).fetchone()[0]
    return d, legacy, other, service, people, {'ada': ada, 'bisi': bisi, 'supplier': supplier, 'foreign_customer': foreign_customer, 'bank': bank}


def answers(ids, **changes):
    base = {'as_of': '2026-10-01', 'cash': '25000.00', 'banks': [{'account_id': str(ids['bank']), 'amount': '400000'}],
            'customers': [{'customer_id': str(ids['ada']), 'amount': '60000'}, {'customer_id': str(ids['bisi']), 'amount': '0'}],
            'suppliers': [{'supplier_id': str(ids['supplier']), 'amount': '150000.50'}], 'loans': '200000', 'capital': '300000', 'notes': ''}
    return {**base, **changes}


def save(business, actor, data, version=0, key=None):
    return run(actor, 'SELECT public.save_opening_position(%s,%s,%s,%s)', (business, key or uuid4(), version, json.dumps(data)))[0][0]


def approve(business, actor, version, note=None):
    return run(actor, 'SELECT public.approve_opening_position(%s,%s,%s)', (business, version, note))[0][0]


def totals(journal):
    debit = sum(Decimal(l['amount']) for l in journal['lines'] if l['side'] == 'debit')
    credit = sum(Decimal(l['amount']) for l in journal['lines'] if l['side'] == 'credit')
    return debit, credit


def test_server_values_stock_and_builds_a_balanced_opening_journal(books):
    _, legacy, _, _, people, ids = books
    saved = save(legacy, people['owner'], answers(ids))
    position = saved['position']
    stock = Decimal('503601.50')  # 10 x 50,000 + 3 x 1,200.50; untracked, archived, negative and services excluded
    assert Decimal(saved['stock_value']) == stock
    s = {k: Decimal(v) for k, v in position['summary'].items()}
    assert s['owns'] == Decimal('25000') + Decimal('400000') + stock + Decimal('60000')
    assert s['owes'] == Decimal('350000.50')
    assert s['owner_equity'] == s['owns'] - s['owes'] and s['retained'] == s['owner_equity'] - Decimal('300000')
    debit, credit = totals(position['journal'])
    assert debit == credit == s['owns']
    by_code = {(l['code'], l.get('party_id')): l for l in position['journal']['lines']}
    assert by_code[('1100', str(ids['ada']))]['amount'] == '60000' and ('1100', str(ids['bisi'])) not in by_code
    assert by_code[('2000', str(ids['supplier']))]['side'] == 'credit' and by_code[('3200', None)]['name'] == 'Retained earnings'
    assert position['status'] == 'draft' and position['journal']['entry_date'] == '2026-10-01'
    assert not any(l['code'] == '3900' for l in position['journal']['lines'])


def test_losses_debit_retained_earnings_and_still_balance(books):
    _, legacy, _, _, people, ids = books
    position = save(legacy, people['owner'], answers(ids, loans='5000000', capital='0'))['position']
    retained = next(l for l in position['journal']['lines'] if l['code'] == '3200')
    assert retained['side'] == 'debit' and Decimal(position['summary']['owner_equity']) < 0
    debit, credit = totals(position['journal'])
    assert debit == credit


def test_retry_replays_and_versions_prevent_lost_updates(books):
    _, legacy, _, _, people, ids = books
    key = uuid4()
    first = save(legacy, people['owner'], answers(ids), key=key)
    again = save(legacy, people['owner'], answers(ids), key=key)
    assert again['replayed'] is True and again['position']['version'] == first['position']['version'] == 1
    with pytest.raises(psycopg.Error, match='REQUEST_KEY_REUSED'):
        save(legacy, people['owner'], answers(ids, cash='1'), key=key)
    with pytest.raises(psycopg.Error, match='VERSION_CONFLICT'):
        save(legacy, people['owner'], answers(ids, cash='1'), version=0)
    assert save(legacy, people['owner'], answers(ids, cash='1'), version=1)['position']['version'] == 2


def test_approval_freezes_the_reviewed_version_and_edits_start_a_new_one(books):
    _, legacy, _, _, people, ids = books
    save(legacy, people['owner'], answers(ids))
    with pytest.raises(psycopg.Error, match='VERSION_CONFLICT'):
        approve(legacy, people['owner'], 2)
    approved = approve(legacy, people['owner'], 1, 'Checked against bank statement')['position']
    assert approved['status'] == 'approved' and approved['approved_at']
    assert approve(legacy, people['owner'], 1)['replayed'] is True
    with psycopg.connect(URL) as c:
        with pytest.raises(psycopg.Error, match='OPENING_POSITION_IMMUTABLE'):
            c.execute("UPDATE onboarding_private.opening_positions SET summary='{}' WHERE business_id=%s AND version=1", (legacy,))
    with psycopg.connect(URL) as c:
        with pytest.raises(psycopg.Error, match='OPENING_POSITION_IMMUTABLE'):
            c.execute('DELETE FROM onboarding_private.opening_positions WHERE business_id=%s', (legacy,))
    edited = save(legacy, people['owner'], answers(ids, cash='30000'), version=1)['position']
    assert (edited['version'], edited['status']) == (2, 'draft')
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT version,status,approval_note FROM onboarding_private.opening_positions WHERE business_id=%s ORDER BY version',
                         (legacy,)).fetchall() == [(1, 'superseded', 'Checked against bank statement'), (2, 'draft', None)]
        assert [r[0] for r in c.execute("SELECT action FROM audit_logs WHERE business_id=%s AND action LIKE 'OPENING%%' ORDER BY created_at", (legacy,))] == \
            ['OPENING_POSITION_SAVED', 'OPENING_POSITION_APPROVED', 'OPENING_POSITION_SAVED']


@pytest.mark.parametrize('change,error', [
    ({'cash': '-1'}, 'INVALID_OPENING_POSITION'), ({'cash': '1.005'}, 'INVALID_OPENING_POSITION'),
    ({'as_of': '2999-01-01'}, 'INVALID_OPENING_POSITION'), ({'as_of': 'not-a-date'}, 'INVALID_OPENING_POSITION'),
    ({'banks': [{'account_id': 'cash', 'amount': '1'}]}, 'ACCOUNT_NOT_FOUND'),
    ({'customers': [{'customer_id': 'foreign_customer', 'amount': '1'}]}, 'CUSTOMER_NOT_FOUND'),
    ({'customers': [{'customer_id': 'ada', 'amount': '1'}, {'customer_id': 'ada', 'amount': '2'}]}, 'INVALID_OPENING_POSITION'),
])
def test_invalid_answers_are_refused_and_nothing_is_saved(books, change, error):
    _, legacy, _, _, people, ids = books
    with psycopg.connect(URL) as c:
        cash_account = c.execute("SELECT id FROM accounts WHERE business_id=%s AND code='1000'", (legacy,)).fetchone()[0]
    lookup = {'cash': cash_account, **ids}
    resolved = {k: ([{kk: str(lookup.get(vv, vv)) if kk.endswith('_id') else vv for kk, vv in e.items()} for e in v] if isinstance(v, list) else v)
                for k, v in change.items()}
    with pytest.raises(psycopg.Error, match=error):
        save(legacy, people['owner'], answers(ids, **resolved))
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT count(*) FROM onboarding_private.opening_positions').fetchone() == (0,)


@pytest.mark.parametrize('role', ['editor', 'viewer', 'outsider'])
def test_only_owners_and_admins_see_save_or_approve(books, role):
    _, legacy, _, _, people, ids = books
    for call in (lambda: save(legacy, people[role], answers(ids)), lambda: approve(legacy, people[role], 1),
                 lambda: run(people[role], 'SELECT public.opening_position(%s)', (legacy,))):
        with pytest.raises(psycopg.Error, match='ACCESS_DENIED'):
            call()


def test_needs_an_adopted_chart_and_unset_books(books):
    d, _, _, service, people, ids = books
    with pytest.raises(psycopg.Error, match='CHART_REQUIRED'):
        save(service, people['owner'], {'cash': '0'})
    with pytest.raises(psycopg.Error, match='BOOKS_ALREADY_SET_UP'):
        save(d[1], d[2], {'cash': '0'})


def test_read_lists_what_the_owner_needs_to_answer(books):
    _, legacy, _, _, people, ids = books
    read = run(people['owner'], 'SELECT public.opening_position(%s)', (legacy,))[0][0]
    assert read['chart_ready'] is True and read['position'] is None and read['books_active'] is False
    assert read['bank_accounts'] == [{'id': str(ids['bank']), 'name': 'Bank account'}]
    assert [c['name'] for c in read['customers']] == ['Ada Stores', 'Bisi'] and [s['name'] for s in read['suppliers']] == ['Mills Ltd']
