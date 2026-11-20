"""Management profitability by product, service, outlet and job (Doc 09 statement set): revenue less refunds and credit
notes, net of VAT; cost of the stock that left, less what came back; profit and margin per item and per outlet."""
from decimal import Decimal
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.profitability import report
from cacu.accounting.refunds import RefundRequest, request as refund_request
from cacu.accounting.vat import VatSettings, save_settings
from cacu.accounting.workflows import InvoiceCreate, invoice_create, sale_create
from test_corrections_postgres import live, call, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_activation_postgres import TODAY
from test_pos_checkout_postgres import sale

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


def items(live):
    result = call(live, 'viewer', lambda s, a: report(s, TODAY, TODAY))
    return result, {i['name']: i for i in result['items']}


def test_profit_per_item_counts_sales_invoices_refunds_and_stock_cost(live):
    made = call(live, 'owner', lambda s, a: sale_create(s, a, sale(live, lines=(('Beans', 2, '0'),))))  # ₦3,000; cost 2 × ₦1,200.50
    call(live, 'owner', lambda s, a: invoice_create(s, a, InvoiceCreate(request_key=uuid4(), customer_id=live.ids['ada'], invoice_number='INV-PR-1',
         entry_date=TODAY, items=[{'catalog_item_id': live.items['Rice'], 'quantity': 1, 'unit_price': '65000.00'}])))  # cost ₦50,000
    result, by = items(live)
    beans, rice = by['Beans'], by['Rice']
    assert (beans['quantity'], beans['revenue'], beans['cost'], beans['profit'], beans['margin']) == (2, '3000.00', '2401.00', '599.00', '20')
    assert (rice['revenue'], rice['cost'], rice['profit']) == ('65000.00', '50000.00', '15000.00')
    assert result['totals']['revenue'] == '68000.00' and result['totals']['profit'] == '15599.00' and 'not reviewed' in result['label']
    assert [i['name'] for i in result['items']][0] == 'Rice'  # most profitable first

    with psycopg.connect(URL) as c:
        line = c.execute('SELECT id FROM transaction_items WHERE transaction_id=%s', (made['saleId'],)).fetchone()[0]
    call(live, 'owner', lambda s, a: refund_request(s, a, made['saleId'], RefundRequest(request_key=uuid4(), lines=[{'line_id': line, 'quantity': 1}], method='Cash', reason='Dented tin')))
    _, by = items(live)
    assert (by['Beans']['quantity'], by['Beans']['revenue'], by['Beans']['cost']) == (1, '1500.00', '1200.50')  # the tin came back to stock
    with pytest.raises(HTTPException):
        call(live, 'viewer', lambda s, a: report(s, TODAY, TODAY.replace(year=TODAY.year - 1)))


def test_vat_is_not_counted_as_revenue(live):
    call(live, 'owner', lambda s, a: save_settings(s, a, VatSettings(registered=True, vat_number='12345678-0001', effective_from=TODAY)))
    call(live, 'owner', lambda s, a: sale_create(s, a, sale(live, lines=(('Beans', 1, '0'),))))  # ₦1,500 including ₦104.65 VAT
    result, by = items(live)
    assert by['Beans']['revenue'] == '1395.35' and by['Beans']['profit'] == format(Decimal('1395.35') - Decimal('1200.50'), '.2f')
    assert [o['name'] for o in result['outlets']] and sum(Decimal(o['revenue']) for o in result['outlets']) == Decimal('1395.35')


def test_kpis_compare_the_period_with_the_one_before_from_the_books(live):
    from cacu.accounting.kpis import kpis
    call(live, 'owner', lambda s, a: sale_create(s, a, sale(live, lines=(('Beans', 2, '0'),))))  # ₦3,000; cost ₦2,401
    call(live, 'owner', lambda s, a: invoice_create(s, a, InvoiceCreate(request_key=uuid4(), customer_id=live.ids['ada'], invoice_number='INV-KPI-1',
         entry_date=TODAY, items=[{'catalog_item_id': live.items['Rice'], 'quantity': 1, 'unit_price': '65000.00'}])))
    result = call(live, 'viewer', lambda s, a: kpis(s, TODAY, TODAY))
    f = {x['key']: x for x in result['figures']}
    assert (f['revenue']['value'], f['revenue']['previous'], f['revenue']['change']) == ('68000.00', '0.00', None)  # nothing the day before
    assert f['gross_profit']['value'] == '15599.00' and f['gross_margin']['value'] == '23'
    assert (f['sales']['value'], f['average_sale']['value']) == ('2', '34000.00')  # opening balances are not sales
    assert f['operating_expenses']['good'] == 'down'
    end = {x['key']: x for x in result['at_end']}
    assert Decimal(end['receivables']['value']) == Decimal('125000.00')  # ₦60,000 from the opening position and the ₦65,000 invoice
    assert end['receivables']['detail'] == 'Nothing overdue'  # both are dated today, so nothing is past due yet
    assert Decimal(end['stock']['value']) > 0 and Decimal(end['cash']['value']) > 0 and result['label'] == 'Management statements, not reviewed'
