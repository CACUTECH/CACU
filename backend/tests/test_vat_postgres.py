"""VAT part 2a (Doc 09 PR-32; Doc 10 E14 R3 part 2): off unless the business is VAT-registered; then 7.5% on
standard-rated items, worked out per document to the kobo; till prices include VAT, invoices say whether theirs do;
the sale or invoice posts revenue net and Output VAT payable (2200); payments, the trial balance and the month's VAT
return all agree. Refunds and credit notes of taxed documents wait for part 2c."""
from decimal import Decimal
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.workflows import InvoiceCreate, ReceiptCreate, invoice_create, receipt_create, sale_create
from cacu.accounting.refunds import RefundRequest, request as refund_request
from cacu.accounting.credit_notes import CreditRequest, request as credit_request
from cacu.accounting.reports import trial_balance
from cacu.accounting.periods import month_start
from cacu.accounting.vat import ItemClasses, VatSettings, overview, save_classes, save_settings, vat_return
from test_corrections_postgres import live, call, balance, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_activation_postgres import TODAY
from test_pos_checkout_postgres import sale

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
REGISTERED = VatSettings(registered=True, vat_number='12345678-0001', effective_from=TODAY)


def taxed(live, source_type, source_id):
    with psycopg.connect(URL) as c:
        return c.execute('SELECT standard_net,zero_rated_net,exempt_net,vat FROM accounting.document_vat WHERE business_id=%s AND source_type=%s AND source_id=%s',
                         (live.business, source_type, source_id)).fetchone()


@pytest.fixture
def registered(live):
    call(live, 'owner', lambda s, a: save_settings(s, a, REGISTERED))
    return live


def test_nothing_changes_until_the_business_is_vat_registered(live):
    made = call(live, 'owner', lambda s, a: sale_create(s, a, sale(live, lines=(('Beans', 2, '0'),))))
    assert made['status'] == 'completed' and taxed(live, 'pos', made['saleId']) is None
    assert balance(live, '4000') == Decimal('-3000.00')  # all revenue, as before
    view = call(live, 'viewer', lambda s, a: overview(s))
    assert not view['registered'] and view['standard_rate'] == '7.5000' and {i['vat_class'] for i in view['items']} == {'standard'}
    with pytest.raises(HTTPException, match='Only the business owner or an Admin'):
        call(live, 'editor', lambda s, a: save_settings(s, a, REGISTERED))
    with pytest.raises(HTTPException, match='VAT number'):
        call(live, 'owner', lambda s, a: save_settings(s, a, VatSettings(registered=True)))
    with pytest.raises(HTTPException, match='on or after the day your books started'):
        call(live, 'owner', lambda s, a: save_settings(s, a, VatSettings(registered=True, vat_number='12345678-0001', effective_from=month_start(TODAY).replace(year=TODAY.year - 1))))


def test_till_sales_include_vat_and_post_it_to_output_vat(registered):
    live = registered
    with psycopg.connect(URL) as c:
        codes = dict(c.execute("SELECT code,name FROM accounts WHERE business_id=%s AND code IN ('1310','1320','2200')", (live.business,)).fetchall())
    assert codes == {'1310': 'Input VAT recoverable', '1320': 'Withholding tax credits', '2200': 'Output VAT payable'}
    cash = call(live, 'owner', lambda s, a: sale_create(s, a, sale(live, lines=(('Beans', 1, '0'),))))  # ₦1,500 including VAT
    assert taxed(live, 'pos', cash['saleId']) == (Decimal('1395.35'), 0, 0, Decimal('104.65'))
    assert balance(live, '2200') == Decimal('-104.65') and balance(live, '4000') == Decimal('-1395.35')

    transfer = call(live, 'owner', lambda s, a: sale_create(s, a, sale(live, 'Transfer', (('Beans', 1, '0'),))))
    assert transfer['status'] == 'pending_payment' and taxed(live, 'pos', transfer['saleId'])[3] == Decimal('104.65')
    with psycopg.connect(URL) as c:  # the customer still pays the shelf price
        assert c.execute('SELECT amount FROM accounting.pending_transfer WHERE business_id=%s AND id=%s', (live.business, transfer['saleId'])).fetchone()[0] == Decimal('1500.00')

    call(live, 'owner', lambda s, a: save_classes(s, a, ItemClasses(items=[{'item_id': live.items['Beans'], 'vat_class': 'zero_rated'}])))
    zero = call(live, 'owner', lambda s, a: sale_create(s, a, sale(live, lines=(('Beans', 1, '0'),))))
    assert taxed(live, 'pos', zero['saleId']) == (0, Decimal('1500.00'), 0, 0)  # zero-rated: on the return, no VAT
    assert balance(live, '2200') == Decimal('-209.30')
    with pytest.raises(HTTPException, match='not in this business'):
        call(live, 'owner', lambda s, a: save_classes(s, a, ItemClasses(items=[{'item_id': uuid4(), 'vat_class': 'exempt'}])))

    tb = call(live, 'viewer', lambda s, a: trial_balance(s, TODAY))
    assert tb['difference'] == '0.00' and [e for e in tb['exceptions'] if e['check'] != 'stock'] == []
    month = call(live, 'viewer', lambda s, a: vat_return(s, month_start(TODAY)))
    assert month['sales'] == {'standard_net': '2790.70', 'zero_rated_net': '1500.00', 'exempt_net': '0.00', 'vat': '209.30', 'documents': 3}
    assert month['purchases']['vat'] == '0.00' and month['payable'] == '209.30' and month['exceptions'] == []
    assert month['vat_number'] == '12345678-0001'


def test_invoices_say_whether_prices_include_vat_and_are_paid_in_full(registered):
    live = registered
    owed = balance(live, '1100')  # customers already owe from the opening position
    plus = InvoiceCreate(request_key=uuid4(), customer_id=live.ids['ada'], invoice_number='INV-VAT-1', entry_date=TODAY,
                         items=[{'catalog_item_id': live.items['Beans'], 'quantity': 2, 'unit_price': '1500.00'}], vat_included=False)
    call(live, 'owner', lambda s, a: invoice_create(s, a, plus))
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT subtotal,tax,total,vat_included FROM invoices WHERE id=%s', (plus.request_key,)).fetchone() == \
            (Decimal('3000.00'), Decimal('225.00'), Decimal('3225.00'), False)
    assert balance(live, '1100') - owed == Decimal('3225.00') and balance(live, '2200') == Decimal('-225.00')
    paid = call(live, 'owner', lambda s, a: receipt_create(s, a, ReceiptCreate(request_key=uuid4(), invoice_id=plus.request_key, amount='3225.00', entry_date=TODAY, method='Cash')))
    assert paid and balance(live, '1100') == owed
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT status FROM invoices WHERE id=%s', (plus.request_key,)).fetchone()[0] == 'paid'

    credit = call(live, 'owner', lambda s, a: sale_create(s, a, sale(live, 'Credit', (('Beans', 1, '0'),), customer_id=live.ids['ada'])))
    with psycopg.connect(URL) as c:  # a credit sale at the till keeps the shelf price, VAT inside it
        assert c.execute('SELECT subtotal,tax,total,vat_included FROM invoices WHERE id=%s', (credit['invoice_id'],)).fetchone() == \
            (Decimal('1395.35'), Decimal('104.65'), Decimal('1500.00'), True)
    with pytest.raises(HTTPException, match='leave the tax amount at zero'):
        call(live, 'owner', lambda s, a: invoice_create(s, a, plus.model_copy(update={'request_key': uuid4(), 'tax': '10.00'})))
    assert call(live, 'viewer', lambda s, a: vat_return(s, month_start(TODAY)))['sales']['vat'] == '329.65'


def test_refunds_and_credit_notes_of_taxed_documents_wait_for_part_2c(registered):
    live = registered
    made = call(live, 'owner', lambda s, a: sale_create(s, a, sale(live, lines=(('Beans', 1, '0'),))))
    with psycopg.connect(URL) as c:
        line = c.execute('SELECT id FROM transaction_items WHERE transaction_id=%s', (made['saleId'],)).fetchone()[0]
    with pytest.raises(HTTPException, match='not available yet'):
        call(live, 'owner', lambda s, a: refund_request(s, a, made['saleId'], RefundRequest(request_key=uuid4(), lines=[{'line_id': line, 'quantity': 1}], method='Cash', reason='Wrong item')))
    invoice = InvoiceCreate(request_key=uuid4(), customer_id=live.ids['ada'], invoice_number='INV-VAT-2', entry_date=TODAY,
                            items=[{'catalog_item_id': live.items['Beans'], 'quantity': 1, 'unit_price': '1500.00'}])
    call(live, 'owner', lambda s, a: invoice_create(s, a, invoice))
    with psycopg.connect(URL) as c:
        item = c.execute('SELECT id FROM invoice_items WHERE invoice_id=%s', (invoice.request_key,)).fetchone()[0]
    with pytest.raises(HTTPException, match='not available yet'):
        call(live, 'owner', lambda s, a: credit_request(s, a, CreditRequest(request_key=uuid4(), invoice_id=invoice.request_key, lines=[{'line_id': item, 'quantity': 1}], reason='Returned')))


def test_output_vat_cannot_be_posted_by_other_documents(registered):
    from cacu.accounting.posting import PostingCommand, post_command
    live = registered
    with psycopg.connect(URL) as c:
        output = c.execute("SELECT id FROM accounts WHERE business_id=%s AND code='2200'", (live.business,)).fetchone()[0]
    journal = PostingCommand(request_key=uuid4(), kind='adjustment', source_id=uuid4(), main_account_id=live.codes['1000'], entry_date=TODAY,
                             narration='Moving VAT by hand', credited=False, lines=[{'account_id': output, 'amount': '50.00', 'credited': True}])
    with pytest.raises(HTTPException, match='charged only by sales and invoices'):
        call(live, 'owner', lambda s, a: post_command(s, a, journal))


# Part 2b: input VAT on bills, bills for received goods and expenses.

def paid_out(live, amount, vat='0.00', **kw):
    from cacu.accounting.workflows import ExpenseCreate
    return ExpenseCreate(request_key=uuid4(), expense_account_id=live.codes['6200'], amount=amount, entry_date=TODAY, method='Cash',
                         description='Diesel for the generator', vat=vat, **kw)


def test_vat_on_purchases_needs_registration_and_stays_within_the_rate(live):
    from cacu.accounting.workflows import expense_create
    with pytest.raises(HTTPException, match='not registered for VAT on that date'):
        call(live, 'owner', lambda s, a: expense_create(s, a, paid_out(live, '10750.00', '750.00')))
    call(live, 'owner', lambda s, a: expense_create(s, a, paid_out(live, '10750.00')))  # unregistered: all of it is the cost
    assert balance(live, '6200') == Decimal('10750.00')
    call(live, 'owner', lambda s, a: save_settings(s, a, REGISTERED))
    with pytest.raises(HTTPException, match='more than 7.5% allows'):
        call(live, 'owner', lambda s, a: expense_create(s, a, paid_out(live, '1075.00', '100.00')))


def test_expenses_and_bills_claim_input_vat_and_the_return_nets_it_off(registered):
    from cacu.accounting.bills import BillCreate, SupplierPaymentCreate, bill_create, list_bills, payment_create
    from cacu.accounting.workflows import ExpenseCreate, ReversalCreate, expense_create, reversal_create
    live = registered
    cash, payables = balance(live, '1000'), balance(live, '2000')
    receipt = paid_out(live, '10750.00', '750.00')  # ₦10,750 paid; ₦750 of it VAT on the receipt
    call(live, 'owner', lambda s, a: expense_create(s, a, receipt))
    assert balance(live, '6200') == Decimal('10000.00') and balance(live, '1310') == Decimal('750.00')
    assert balance(live, '1000') - cash == Decimal('-10750.00')

    supplier_bill = BillCreate(request_key=uuid4(), supplier_id=live.ids['supplier'], bill_number='MILLS-77', entry_date=TODAY,
                               lines=[{'account_id': live.codes['6100'], 'amount': '20000.00'}], vat='1500.00')
    made = call(live, 'owner', lambda s, a: bill_create(s, a, supplier_bill))
    assert balance(live, '6100') == Decimal('20000.00') and balance(live, '1310') == Decimal('2250.00')
    assert balance(live, '2000') - payables == Decimal('-21500.00')  # the supplier is owed the VAT too
    listed = next(b for b in call(live, 'owner', lambda s, a: list_bills(s)) if b['id'] == made['id'])
    assert listed['total'] == '21500.00'
    call(live, 'owner', lambda s, a: payment_create(s, a, made['id'], SupplierPaymentCreate(request_key=uuid4(), amount='21500.00', entry_date=TODAY, method='Cash')))
    assert next(b for b in call(live, 'owner', lambda s, a: list_bills(s)) if b['id'] == made['id'])['status'] == 'paid'

    call(live, 'owner', lambda s, a: sale_create(s, a, sale(live, lines=(('Beans', 1, '0'),))))  # ₦104.65 output VAT
    month = call(live, 'viewer', lambda s, a: vat_return(s, month_start(TODAY)))
    assert month['purchases'] == {'standard_net': '30000.00', 'zero_rated_net': '0.00', 'exempt_net': '0.00', 'vat': '2250.00', 'documents': 2}
    assert month['payable'] == '-2145.35' and month['exceptions'] == []  # more paid than charged: reclaimable
    tb = call(live, 'viewer', lambda s, a: trial_balance(s, TODAY))
    assert tb['difference'] == '0.00' and [e for e in tb['exceptions'] if e['check'] != 'stock'] == []

    with pytest.raises(HTTPException, match='not available yet'):  # taking VAT back comes in part 2c
        call(live, 'owner', lambda s, a: reversal_create(s, a, receipt.request_key, ReversalCreate(request_key=uuid4(), entry_date=TODAY, reason='Entered twice')))
    with pytest.raises(ValueError, match='pattern'):  # a negative VAT never reaches the books
        BillCreate(request_key=uuid4(), supplier_id=live.ids['supplier'], bill_number='X', entry_date=TODAY,
                   lines=[{'account_id': live.codes['6100'], 'amount': '1.00'}], vat='-1')


def test_a_bill_for_received_goods_claims_its_vat(registered):
    from test_goods_receipts_postgres import got
    from test_goods_bills_postgres import bill
    live = registered
    receipt, _ = got(live, supplier_id=live.ids['supplier'], lines=[('Beans', 10, '1300')])
    payables, grni = balance(live, '2000'), balance(live, '2010')
    billed, _ = bill(live, receipt, 10, '13000.00', vat='975.00')
    assert billed['total'] == '13000.00' and balance(live, '1310') == Decimal('975.00')
    assert balance(live, '2000') - payables == Decimal('-13975.00') and balance(live, '2010') - grni == Decimal('13000.00')  # the bill clears what was received
    assert call(live, 'viewer', lambda s, a: vat_return(s, month_start(TODAY)))['purchases']['vat'] == '975.00'


def test_input_vat_is_claimed_only_on_bills_and_expenses(registered):
    from cacu.accounting.posting import PostingCommand, post_command
    live = registered
    with psycopg.connect(URL) as c:
        claim = c.execute("SELECT id FROM accounts WHERE business_id=%s AND code='1310'", (live.business,)).fetchone()[0]
    journal = PostingCommand(request_key=uuid4(), kind='adjustment', source_id=uuid4(), main_account_id=live.codes['1000'], entry_date=TODAY,
                             narration='Claiming VAT by hand', credited=True, lines=[{'account_id': claim, 'amount': '50.00', 'credited': False}])
    with pytest.raises(HTTPException, match='claimed only on bills and expenses'):
        call(live, 'owner', lambda s, a: post_command(s, a, journal))
