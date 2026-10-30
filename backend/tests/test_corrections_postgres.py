"""Expenses (FR-120, PR-17), reversals (FR-112, PR-26) and stock adjustments with approval (FR-080, BR-021, PR-20)
on a business whose books were turned on from an approved opening position."""
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.catalog import CatalogMutation, catalog_mutate
from cacu.accounting.reports import financial_summary
from cacu.accounting.stock import AdjustmentRequest, Decision, Policy, decide, list_adjustments, policy, request_adjustment, set_policy
from cacu.accounting.workflows import (ExpenseCreate, ReversalCreate, expense_accounts, expense_create, recent_documents,
                                       reversal_create)
from cacu.accounting.posting import PostingCommand, post_command
from test_library_postgres import session_for
from test_management_postgres import managed, database, URL
from test_legacy_write_boundary_postgres import boundary
from test_default_chart_postgres import charted
from test_opening_position_postgres import books
from test_activation_postgres import TODAY, approved, turn_on

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


@pytest.fixture
def live(books):
    d, legacy, _, _, people, ids = books
    admin = uuid4()
    with psycopg.connect(URL) as c:
        c.execute("INSERT INTO memberships(business_id,user_id,role,is_active) VALUES(%s,%s,'admin',true)", (legacy, admin))
    approved(books)
    turn_on(books)
    with psycopg.connect(URL) as c:
        entity = c.execute('SELECT entity_id FROM accounting.business_map WHERE business_id=%s', (legacy,)).fetchone()[0]
        codes = dict(c.execute('SELECT code,id FROM accounts WHERE business_id=%s', (legacy,)).fetchall())
        items = {r[0]: r[1] for r in c.execute('SELECT name,id FROM catalog_items WHERE business_id=%s', (legacy,))}
    return SimpleNamespace(engine=d[0], business=legacy, entity=entity, codes=codes, items=items, ids=ids,
                           people={**people, 'admin': admin})


def call(live, who, work):
    """Run work(session, actor) as one runtime transaction, the way library_transaction does."""
    actor = live.people[who]
    with live.engine.begin() as c:
        s = session_for(c, (live.engine, live.business, actor, live.entity, None, None, TODAY.year))
        try:
            return work(s, actor)
        finally:
            s.close()


def balance(live, code):
    with psycopg.connect(URL) as c:
        return c.execute("""SELECT coalesce(sum(CASE WHEN l.entry_type::text='DEBIT' THEN l.amount ELSE -l.amount END),0)
            FROM accounting.ledger l JOIN accounting.account_map m ON m.library_id=l.post_account_id AND m.business_id=l.business_id
            JOIN accounts a ON a.id=m.account_id WHERE l.business_id=%s AND a.code=%s""", (live.business, code)).fetchone()[0]


def stock(live, name):
    with psycopg.connect(URL) as c:
        return c.execute('SELECT stock_quantity,version FROM catalog_items WHERE id=%s', (live.items[name],)).fetchone()


def expense(live, code='6200', amount='15000.00', method='Cash', **kw):
    return ExpenseCreate(request_key=uuid4(), expense_account_id=live.codes[code], amount=amount, entry_date=TODAY,
                         method=method, description='Diesel for the generator', **kw)


def adjustment(live, delta, name='Rice', reason='Water damage'):
    return AdjustmentRequest(request_key=uuid4(), item_id=live.items[name], expected_version=stock(live, name)[1],
                             delta=delta, reason=reason, entry_date=TODAY)


def test_expense_posts_against_cash_and_lists_with_its_reversal(live):
    choices = call(live, 'editor', lambda s, a: expense_accounts(s))
    codes = [c['code'] for c in choices]
    assert '6200' in codes and '7000' in codes and '5000' not in codes and '5100' not in codes and '1000' not in codes
    data = expense(live)
    first = call(live, 'editor', lambda s, a: expense_create(s, a, data))
    assert call(live, 'editor', lambda s, a: expense_create(s, a, data)) == first  # a retry replays
    assert balance(live, '6200') == Decimal('15000.00') and balance(live, '1000') == Decimal('10000.00')
    listed = call(live, 'viewer', lambda s, a: recent_documents(s, 'expense'))
    assert [(e['id'], e['amount'], e['description'], e['reversed']) for e in listed] == \
        [(str(data.request_key), '15000.00', 'Diesel for the generator', False)]

    with pytest.raises(HTTPException, match='Owner or Admin'):
        call(live, 'editor', lambda s, a: reversal_create(s, a, data.request_key, ReversalCreate(request_key=uuid4(), entry_date=TODAY, reason='Wrong account')))
    undo = ReversalCreate(request_key=uuid4(), entry_date=TODAY, reason='Entered twice')
    result = call(live, 'admin', lambda s, a: reversal_create(s, a, data.request_key, undo))
    assert result['posting']['amount'] == '15000.00'
    assert balance(live, '6200') == 0 and balance(live, '1000') == Decimal('25000.00')
    assert call(live, 'viewer', lambda s, a: recent_documents(s, 'expense'))[0]['reversed'] is True
    with pytest.raises(HTTPException, match='already reversed'):
        call(live, 'owner', lambda s, a: reversal_create(s, a, data.request_key, ReversalCreate(request_key=uuid4(), entry_date=TODAY, reason='Again')))
    with psycopg.connect(URL) as c:
        audit = c.execute("SELECT details->>'transaction_no' FROM accounting.audit_event WHERE business_id=%s AND event='reversal'", (live.business,)).fetchall()
        narration = c.execute('SELECT narration FROM accounting."transaction" WHERE business_id=%s AND transaction_no=%s', (live.business, audit[0][0])).fetchone()[0]
    assert len(audit) == 1 and narration.endswith(': Entered twice')


@pytest.mark.parametrize('change, error', [
    ({'code': '5000'}, 'expense account'), ({'code': '1100'}, 'expense account'), ({'amount': '0'}, 'above zero'),
    ({'method': 'Transfer'}, 'Select a bank account'), ({'bank_account_id': uuid4(), 'method': 'Transfer'}, 'unavailable'),
])
def test_expense_refusals_post_nothing(live, change, error):
    with pytest.raises(HTTPException, match=error):
        call(live, 'owner', lambda s, a: expense_create(s, a, expense(live, **change)))
    assert balance(live, '6200') == 0 and balance(live, '1000') == Decimal('25000.00')


def test_expense_paid_by_transfer_comes_out_of_the_bank(live):
    call(live, 'owner', lambda s, a: expense_create(s, a, expense(live, '6100', '120000', 'Transfer', bank_account_id=live.ids['bank'])))
    assert balance(live, '1010') == Decimal('280000.00') and balance(live, '6100') == Decimal('120000.00')


def test_viewers_cannot_record_expenses(live):
    with pytest.raises(HTTPException, match='Owners, Admins and Editors'):
        call(live, 'viewer', lambda s, a: expense_create(s, a, expense(live)))


def test_manual_compound_journal_is_reversed_exactly(live):
    key = uuid4()
    # Owner drew 20000 cash and 30000 from the bank: one compound journal, as /journals posts it.
    journal = PostingCommand(request_key=key, kind='adjustment', source_id=key, main_account_id=live.codes['3100'], entry_date=TODAY,
                             narration='Owner drawings', credited=False, main_amount='50000.00',
                             lines=[{'account_id': live.codes['1000'], 'amount': '20000', 'credited': True},
                                    {'account_id': live.codes['1010'], 'amount': '30000', 'credited': True}])
    call(live, 'owner', lambda s, a: post_command(s, a, journal))
    assert (balance(live, '3100'), balance(live, '1000'), balance(live, '1010')) == (Decimal('50000'), Decimal('5000'), Decimal('370000'))
    listed = call(live, 'viewer', lambda s, a: recent_documents(s, 'adjustment'))
    assert [(j['id'], j['amount'], j['reversed']) for j in listed] == [(str(key), '50000.00', False)]
    call(live, 'owner', lambda s, a: reversal_create(s, a, key, ReversalCreate(request_key=uuid4(), entry_date=TODAY, reason='Was a loan, not drawings')))
    assert (balance(live, '3100'), balance(live, '1000'), balance(live, '1010')) == (0, Decimal('25000'), Decimal('400000'))
    summary = call(live, 'owner', lambda s, a: financial_summary(s, TODAY, TODAY))
    assert summary['trial_balance_difference'] == summary['balance_sheet_difference'] == '0.00'


def test_documents_other_than_journals_and_expenses_cannot_be_reversed(live):
    with psycopg.connect(URL) as c:
        opening, invoice = (c.execute('SELECT source_id FROM accounting.document_map WHERE business_id=%s AND source_type=%s', (live.business, t)).fetchone()[0]
                            for t in ('opening_balance', 'invoice'))
    for target in (opening, invoice, uuid4()):
        with pytest.raises(HTTPException, match='Only posted manual journals and expenses'):
            call(live, 'owner', lambda s, a: reversal_create(s, a, target, ReversalCreate(request_key=uuid4(), entry_date=TODAY, reason='No')))
    # A stock adjustment's journal is corrected by another adjustment, never reversed on its own.
    posted = call(live, 'owner', lambda s, a: request_adjustment(s, a, adjustment(live, -1)))
    with pytest.raises(HTTPException, match='Only posted manual journals and expenses'):
        call(live, 'owner', lambda s, a: reversal_create(s, a, posted['adjustment']['id'], ReversalCreate(request_key=uuid4(), entry_date=TODAY, reason='No')))


def test_owner_adjustment_posts_directly_to_stock_write_offs(live):
    result = call(live, 'owner', lambda s, a: request_adjustment(s, a, adjustment(live, -2)))
    assert result['adjustment']['status'] == 'posted' and result['adjustment']['value'] == '100000.00'
    assert result['adjustment']['decision_note'] == 'Within the approval limit' and result['item']['stock_quantity'] == 8
    assert stock(live, 'Rice')[0] == 8
    assert balance(live, '5100') == Decimal('100000.00') and balance(live, '1200') == Decimal('403601.50')
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT count(*) FROM inventory_movements WHERE business_id=%s AND id=%s', (live.business, result['adjustment']['id'])).fetchone() == (1,)


def test_editor_request_waits_for_another_person_and_then_posts(live):
    pending = call(live, 'editor', lambda s, a: request_adjustment(s, a, adjustment(live, 3, 'Beans', 'Found in back store')))
    assert pending['adjustment']['status'] == 'pending' and pending['item'] is None and pending['adjustment']['value'] == '3601.50'
    assert stock(live, 'Beans')[0] == 3 and balance(live, '5100') == 0
    queue = call(live, 'viewer', lambda s, a: list_adjustments(s, 'pending'))
    assert [(q['id'], q['item_name']) for q in queue] == [(pending['adjustment']['id'], 'Beans')]
    with pytest.raises(HTTPException, match='Only an Owner or Admin'):
        call(live, 'editor', lambda s, a: decide(s, a, pending['adjustment']['id'], True, Decision()))
    done = call(live, 'admin', lambda s, a: decide(s, a, pending['adjustment']['id'], True, Decision(note='Counted it myself')))
    assert done['adjustment']['status'] == 'posted' and done['adjustment']['decided_by'] == str(live.people['admin'])
    assert stock(live, 'Beans')[0] == 6 and balance(live, '5100') == Decimal('-3601.50') and balance(live, '1200') == Decimal('507203.00')
    with pytest.raises(HTTPException, match='already posted'):
        call(live, 'owner', lambda s, a: decide(s, a, pending['adjustment']['id'], False, Decision(note='Too late')))
    events = [r[0] for r in psycopg.connect(URL).execute("SELECT event FROM accounting.audit_event WHERE business_id=%s AND request_key=%s ORDER BY id",
                                                         (live.business, pending['adjustment']['id']))]
    assert events == ['stock_adjustment_requested', 'adjustment', 'stock_adjustment_approved']


def test_threshold_and_separation_of_duties(live):
    with pytest.raises(HTTPException, match='Only the Owner'):
        call(live, 'admin', lambda s, a: set_policy(s, a, Policy(stock_threshold='50000')))
    assert call(live, 'owner', lambda s, a: set_policy(s, a, Policy(stock_threshold='50000'))) == {'stock_threshold': '50000.00', 'separation_of_duties': True}
    small = call(live, 'admin', lambda s, a: request_adjustment(s, a, adjustment(live, -1, 'Beans')))
    assert small['adjustment']['status'] == 'posted'
    big = call(live, 'admin', lambda s, a: request_adjustment(s, a, adjustment(live, -2)))
    assert big['adjustment']['status'] == 'pending' and stock(live, 'Rice')[0] == 10
    with pytest.raises(HTTPException, match='other than the requester'):
        call(live, 'admin', lambda s, a: decide(s, a, big['adjustment']['id'], True, Decision()))
    # A sole trader can turn separation off and then approve their own request.
    call(live, 'owner', lambda s, a: set_policy(s, a, Policy(stock_threshold='50000', separation_of_duties=False)))
    assert call(live, 'admin', lambda s, a: decide(s, a, big['adjustment']['id'], True, Decision()))['adjustment']['status'] == 'posted'
    assert stock(live, 'Rice')[0] == 8
    assert call(live, 'viewer', lambda s, a: policy(s))['separation_of_duties'] is False


def test_rejection_and_withdrawal_change_nothing(live):
    first = call(live, 'editor', lambda s, a: request_adjustment(s, a, adjustment(live, -1)))
    second = call(live, 'editor', lambda s, a: request_adjustment(s, a, adjustment(live, -1)))
    with pytest.raises(HTTPException, match='Say why'):
        call(live, 'owner', lambda s, a: decide(s, a, first['adjustment']['id'], False, Decision()))
    rejected = call(live, 'owner', lambda s, a: decide(s, a, first['adjustment']['id'], False, Decision(note='Count again')))
    withdrawn = call(live, 'editor', lambda s, a: decide(s, a, second['adjustment']['id'], False, Decision()))
    assert (rejected['adjustment']['status'], withdrawn['adjustment']['status']) == ('rejected', 'rejected')
    assert withdrawn['adjustment']['decision_note'] == 'Withdrawn by the requester'
    assert stock(live, 'Rice')[0] == 10 and balance(live, '5100') == 0
    assert call(live, 'viewer', lambda s, a: list_adjustments(s, 'pending')) == []
    with psycopg.connect(URL) as c:
        with pytest.raises(psycopg.Error, match='ADJUSTMENT_ALREADY_DECIDED'):
            c.execute("UPDATE accounting.stock_adjustment SET status='posted' WHERE id=%s", (first['adjustment']['id'],))


def test_approval_rechecks_stock_and_cost(live):
    short = call(live, 'editor', lambda s, a: request_adjustment(s, a, adjustment(live, -3, 'Beans')))
    costed = call(live, 'editor', lambda s, a: request_adjustment(s, a, adjustment(live, -1)))
    call(live, 'owner', lambda s, a: request_adjustment(s, a, adjustment(live, -1, 'Beans', 'Sold off the books')))
    with pytest.raises(HTTPException, match='would make it negative'):
        call(live, 'owner', lambda s, a: decide(s, a, short['adjustment']['id'], True, Decision()))
    with psycopg.connect(URL) as c:
        c.execute('ALTER TABLE catalog_items DISABLE TRIGGER USER')
        c.execute('UPDATE catalog_items SET cost_price=52000 WHERE id=%s', (live.items['Rice'],))
        c.execute('ALTER TABLE catalog_items ENABLE TRIGGER USER')
    with pytest.raises(HTTPException, match='cost changed'):
        call(live, 'owner', lambda s, a: decide(s, a, costed['adjustment']['id'], True, Decision()))
    assert stock(live, 'Rice')[0] == 10 and [q['status'] for q in call(live, 'owner', lambda s, a: list_adjustments(s, 'pending'))] == ['pending', 'pending']


@pytest.mark.parametrize('change, error', [
    ({'delta': 0}, 'other than zero'), ({'delta': -11}, 'would make it negative'), ({'expected_version': 99}, 'Item changed'),
    ({'name': 'Delivery'}, 'tracked'), ({'name': 'Untracked'}, 'tracked'),
])
def test_invalid_requests_record_nothing(live, change, error):
    name = change.pop('name', 'Rice')
    data = adjustment(live, change.pop('delta', -1), name).model_copy(update=change)
    with pytest.raises(HTTPException, match=error):
        call(live, 'editor', lambda s, a: request_adjustment(s, a, data))
    assert call(live, 'owner', lambda s, a: list_adjustments(s)) == []


def test_catalog_screen_adjustments_follow_the_same_rules(live):
    version = stock(live, 'Rice')[1]
    as_editor = CatalogMutation(request_key=uuid4(), operation='stock.adjust', item_id=live.items['Rice'], expected_version=version,
                                details={'delta': -1, 'reason': 'Spoilt', 'entry_date': TODAY.isoformat()})
    result = call(live, 'editor', lambda s, a: catalog_mutate(s, a, as_editor))
    assert result['adjustment']['status'] == 'pending' and 'stock_quantity' not in result
    as_owner = as_editor.model_copy(update={'request_key': uuid4()})
    result = call(live, 'owner', lambda s, a: catalog_mutate(s, a, as_owner))
    assert result['adjustment']['status'] == 'posted' and result['stock_quantity'] == 9
