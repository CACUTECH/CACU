"""Fixed assets (R4; IAS 16): assets bought paid, on credit or owned before the books started; each month's
depreciation posted by an Owner or Admin, months in order, and month close refusing a month without it; disposals
taking the asset out of the books with a gain or loss. The register is fixed once made."""
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.assets import AddAsset, Dispose, PostDepreciation, add_asset, dispose, overview, post_month, preview
from cacu.accounting.bills import SupplierPaymentCreate, list_bills, payment_create
from cacu.accounting.periods import checklist, month_end, month_start
from cacu.accounting.reports import cash_flow, opening_transactions
from cacu.accounting.vat import VatSettings, save_settings
from test_corrections_postgres import live, call, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_activation_postgres import TODAY

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
THIS_MONTH = month_start(TODAY)
LAST_MONTH = month_start(THIS_MONTH - timedelta(days=1))
EARLIER_MONTH = month_start(LAST_MONTH - timedelta(days=1))


def started(live, month):
    """The books started at the beginning of an earlier month (the fixture starts them today)."""
    with psycopg.connect(URL) as c:
        c.execute('UPDATE accounting.business_map SET cutover_date=%s WHERE business_id=%s', (month, live.business))
    return live


def asset(**over):
    data = {'request_key': uuid4(), 'name': 'Shop laptop', 'category': 'computers', 'acquired_on': EARLIER_MONTH + timedelta(days=4),
            'cost': '1200000.00', 'method': 'straight_line', 'useful_life_months': 12, 'how': 'paid', 'pay_method': 'Cash'}
    return AddAsset(**{**data, **over})


def by_purpose(live, purpose):
    """What the books hold on an account found by its purpose: debits less credits."""
    with psycopg.connect(URL) as c:
        return c.execute("""SELECT coalesce(sum(CASE WHEN l.entry_type::text='DEBIT' THEN l.amount ELSE -l.amount END),0)
            FROM accounting.ledger l JOIN accounting.account_map m ON m.library_id=l.post_account_id AND m.business_id=l.business_id
            WHERE l.business_id=%s AND m.purpose=%s""", (live.business, purpose)).fetchone()[0]


def code(live, purpose):
    with psycopg.connect(URL) as c:
        return c.execute("""SELECT a.code FROM accounting.account_map m JOIN public.accounts a ON a.id=m.account_id AND a.business_id=m.business_id
            WHERE m.business_id=%s AND m.purpose=%s""", (live.business, purpose)).fetchone()[0]


def post(live, month, who='owner'):
    return call(live, who, lambda s, a: post_month(s, a, month.strftime('%Y-%m'), PostDepreciation(request_key=uuid4())))


def step(live, month):
    return next(s for s in call(live, 'owner', lambda s, a: checklist(s, month)) if s['key'] == 'depreciation')


def test_a_paid_asset_is_depreciated_month_by_month_in_order_and_month_close_waits_for_it(live):
    started(live, EARLIER_MONTH)
    with pytest.raises(HTTPException) as refused:
        call(live, 'editor', lambda s, a: add_asset(s, a, asset()))
    assert refused.value.status_code == 403
    laptop = call(live, 'admin', lambda s, a: add_asset(s, a, asset()))
    assert (laptop['carrying_amount'], laptop['depreciate_from']) == ('1200000.00', EARLIER_MONTH.strftime('%Y-%m'))
    assert by_purpose(live, 'asset_computers') == Decimal('1200000') and code(live, 'asset_computers') == '1540'

    view = call(live, 'viewer', lambda s, a: overview(s))
    assert view['due'] == [EARLIER_MONTH.strftime('%Y-%m'), LAST_MONTH.strftime('%Y-%m')]
    assert step(live, EARLIER_MONTH)['passed'] is False and step(live, EARLIER_MONTH)['blocking'] is True
    with pytest.raises(HTTPException, match='first: months are posted in order'):
        post(live, LAST_MONTH)
    with pytest.raises(HTTPException, match='once the month has ended'):
        post(live, THIS_MONTH)
    with pytest.raises(HTTPException) as refused:
        post(live, EARLIER_MONTH, who='editor')
    assert refused.value.status_code == 403

    assert call(live, 'owner', lambda s, a: preview(s, EARLIER_MONTH.strftime('%Y-%m')))['total'] == '100000.00'
    first = post(live, EARLIER_MONTH)
    assert first['total'] == '100000.00'
    assert by_purpose(live, 'depreciation') == Decimal('100000') and by_purpose(live, 'accdep_computers') == Decimal('-100000')
    assert (code(live, 'depreciation'), code(live, 'accdep_computers')) == ('6700', '1640')
    assert step(live, EARLIER_MONTH)['passed'] is True
    again = post(live, EARLIER_MONTH)  # posting a month again changes nothing
    assert again['posted'] and by_purpose(live, 'depreciation') == Decimal('100000')
    post(live, LAST_MONTH)
    view = call(live, 'viewer', lambda s, a: overview(s))
    assert view['due'] == [] and view['assets'][0]['carrying_amount'] == '1000000.00'
    assert [r['month'] for r in view['runs']] == [LAST_MONTH.strftime('%Y-%m'), EARLIER_MONTH.strftime('%Y-%m')]

    with psycopg.connect(URL) as c:  # the register and its depreciation are never changed
        with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
            c.execute('UPDATE accounting.fixed_asset SET cost=1')
    with psycopg.connect(URL) as c:
        with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
            c.execute('DELETE FROM accounting.depreciation_charge')
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE cacu_runtime')
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            c.execute('DELETE FROM accounting.depreciation_run')


def test_an_asset_owned_before_the_books_started_comes_in_with_its_depreciation_to_date(live):
    started(live, EARLIER_MONTH)
    with pytest.raises(HTTPException, match='bought after your books started'):
        call(live, 'owner', lambda s, a: add_asset(s, a, asset(how='existing', brought_in_on=EARLIER_MONTH, accumulated_depreciation='100.00')))
    with pytest.raises(HTTPException, match='cannot be more than the cost'):
        call(live, 'owner', lambda s, a: add_asset(s, a, asset(how='existing', acquired_on=EARLIER_MONTH - timedelta(days=700),
                                                                brought_in_on=EARLIER_MONTH, accumulated_depreciation='1200000.01')))
    van = call(live, 'owner', lambda s, a: add_asset(s, a, asset(
        name='Delivery van', category='vehicles', how='existing', acquired_on=EARLIER_MONTH - timedelta(days=700), brought_in_on=EARLIER_MONTH,
        cost='600000.00', accumulated_depreciation='300000.00', method='reducing_balance', useful_life_months=None, annual_rate_percent='25')))
    assert (van['carrying_amount'], van['accumulated_depreciation']) == ('300000.00', '300000.00')
    assert by_purpose(live, 'asset_vehicles') == Decimal('600000') and by_purpose(live, 'accdep_vehicles') == Decimal('-300000')
    assert by_purpose(live, 'retained_earnings') <= Decimal('-300000')  # credited with what the van was worth
    with psycopg.connect(URL) as c:
        brought = c.execute('SELECT transaction_id FROM accounting.fixed_asset WHERE business_id=%s', (live.business,)).fetchone()[0]
    assert brought in call(live, 'owner', lambda s, a: opening_transactions(s))  # a position brought in, not cash activity
    # Reducing balance: 25% a year on 300,000 is 6,250 a month, then on what is left.
    assert post(live, EARLIER_MONTH)['total'] == '6250.00'
    assert post(live, LAST_MONTH)['total'] == '6119.79'  # 293,750 x 25% / 12


def test_an_asset_bought_on_credit_is_a_supplier_bill_paid_like_any_other(live):
    started(live, EARLIER_MONTH)
    supplier = uuid4()
    with psycopg.connect(URL) as c:
        c.execute('INSERT INTO suppliers(id,business_id,name) VALUES(%s,%s,%s)', (supplier, live.business, 'Ikeja Furniture'))
    with pytest.raises(HTTPException, match='supplier and enter their bill number'):
        call(live, 'owner', lambda s, a: add_asset(s, a, asset(how='credit', pay_method=None, supplier_id=supplier)))
    shelves = call(live, 'owner', lambda s, a: add_asset(s, a, asset(name='Shelves', category='furniture', how='credit', pay_method=None,
                                                                  supplier_id=supplier, bill_number='IF-77', cost='250000.00', useful_life_months=60)))
    assert shelves['how'] == 'credit' and by_purpose(live, 'asset_furniture') == Decimal('250000')
    bill = next(b for b in call(live, 'viewer', lambda s, a: list_bills(s)) if b['bill_number'] == 'IF-77')
    assert (bill['supplier_name'], bill['total'], bill['status']) == ('Ikeja Furniture', '250000.00', 'unpaid')
    call(live, 'owner', lambda s, a: payment_create(s, a, bill['id'], SupplierPaymentCreate(request_key=uuid4(), amount='250000.00', entry_date=TODAY, method='Cash')))
    assert next(b for b in call(live, 'viewer', lambda s, a: list_bills(s)) if b['bill_number'] == 'IF-77')['status'] == 'paid'


def test_a_disposal_takes_the_asset_out_with_its_gain_or_loss(live):
    started(live, EARLIER_MONTH)
    key = uuid4()
    laptop = call(live, 'owner', lambda s, a: add_asset(s, a, asset()))
    with pytest.raises(HTTPException, match='Post depreciation for'):
        call(live, 'owner', lambda s, a: dispose(s, a, laptop['id'], Dispose(request_key=key, disposed_on=LAST_MONTH, proceeds='1150000.00', method='Cash')))
    post(live, EARLIER_MONTH)
    sold = call(live, 'owner', lambda s, a: dispose(s, a, laptop['id'], Dispose(request_key=key, disposed_on=LAST_MONTH, proceeds='1150000.00', method='Cash')))
    assert (sold['disposed_on'], sold['carrying_amount'], sold['disposal_result']) == (LAST_MONTH.isoformat(), '0.00', '50000.00')
    assert by_purpose(live, 'asset_computers') == 0 and by_purpose(live, 'accdep_computers') == 0
    assert by_purpose(live, 'disposal_gains') == Decimal('-50000')  # a gain: proceeds 1,150,000 less carrying 1,100,000
    # IAS 7: the proceeds are an investing receipt, and the gain comes out of operating profit.
    flows = call(live, 'viewer', lambda s, a: cash_flow(s, LAST_MONTH, month_end(LAST_MONTH)))
    lines = {(sec['key'], l['label']): l['amount'] for sec in flows['sections'] for l in sec['lines']}
    assert lines[('investing', 'Fixed assets sold / receipts')] == '1150000.00'
    assert lines[('operating', 'Gain or loss on disposal of fixed assets')] == '-50000.00'
    assert next(sec['total'] for sec in flows['sections'] if sec['key'] == 'investing') == '1150000.00'
    again = call(live, 'owner', lambda s, a: dispose(s, a, laptop['id'], Dispose(request_key=key, disposed_on=LAST_MONTH, proceeds='1150000.00', method='Cash')))
    assert again == sold  # a retried request
    with pytest.raises(HTTPException, match='already been disposed of'):
        call(live, 'owner', lambda s, a: dispose(s, a, laptop['id'], Dispose(request_key=uuid4(), disposed_on=LAST_MONTH)))
    view = call(live, 'viewer', lambda s, a: overview(s))
    assert view['due'] == [] and view['totals']['carrying_amount'] == '0.00'  # nothing charged in the month it went
    assert step(live, LAST_MONTH)['passed'] is True

    scrapped = call(live, 'owner', lambda s, a: add_asset(s, a, asset(name='Old printer', acquired_on=LAST_MONTH, cost='90000.00')))
    gone = call(live, 'owner', lambda s, a: dispose(s, a, scrapped['id'], Dispose(request_key=uuid4(), disposed_on=LAST_MONTH)))
    assert gone['disposal_result'] == '-90000.00'  # scrapped for nothing: a loss of its carrying amount


def test_a_vat_registered_business_claims_the_input_vat_on_what_it_buys(live):
    started(live, EARLIER_MONTH)
    with pytest.raises(HTTPException, match='not registered for VAT'):
        call(live, 'owner', lambda s, a: add_asset(s, a, asset(vat='15000.00')))
    call(live, 'owner', lambda s, a: save_settings(s, a, VatSettings(registered=True, vat_number='12345678-0001', effective_from=TODAY)))
    with pytest.raises(HTTPException, match='more than 7.5% allows'):
        call(live, 'owner', lambda s, a: add_asset(s, a, asset(acquired_on=TODAY, cost='200000.00', vat='15000.01')))
    key = uuid4()
    call(live, 'owner', lambda s, a: add_asset(s, a, asset(request_key=key, acquired_on=TODAY, cost='200000.00', vat='15000.00')))
    assert by_purpose(live, 'asset_computers') == Decimal('200000') and by_purpose(live, 'vat_input') == Decimal('15000')
    with psycopg.connect(URL) as c:
        assert c.execute("SELECT standard_net, vat FROM accounting.document_vat WHERE business_id=%s AND source_type='asset_purchase' AND source_id=%s",
                         (live.business, key)).fetchone() == (Decimal('200000.00'), Decimal('15000.00'))
    with pytest.raises(HTTPException, match='no VAT to claim'):
        call(live, 'owner', lambda s, a: add_asset(s, a, asset(how='existing', acquired_on=EARLIER_MONTH - timedelta(days=30), brought_in_on=TODAY, vat='100.00')))


def test_asset_kinds_cannot_be_posted_through_the_generic_route(live):
    from cacu.accounting.posting import PostingCommand, PostingLine, post_command
    for kind in ('asset_purchase', 'asset_opening', 'depreciation', 'asset_disposal'):
        with pytest.raises(HTTPException) as refused:
            call(live, 'owner', lambda s, a: post_command(s, a, PostingCommand(
                request_key=uuid4(), kind=kind, source_id=uuid4(), main_account_id=uuid4(), entry_date=TODAY,
                narration='Sneaky', lines=[PostingLine(account_id=uuid4(), amount='1.00')])))
        assert refused.value.status_code == 422
