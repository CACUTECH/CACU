"""Jobs, bookings part 4 (Doc 10 services rules): jobs with service and material lines and labour, completed through the
accounting API so materials leave stock at cost, billed once at the till or by invoice without issuing the materials
again, and job profit on Chairman. On a business started from the real chart."""
from decimal import Decimal
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.jobs import CostRates, JobComplete, JobInvoice, bill_invoice, complete, cost_rates, detail, save_cost_rates
from cacu.accounting.workflows import SaleCreate, sale_create
from test_corrections_postgres import live, call, balance, stock, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_pos_checkout_postgres import as_template
from test_pos_refunds_postgres import as_member, books_balance
from test_bookings_postgres import salon  # noqa: F401
from test_pos_shifts_postgres import on_plan
from test_activation_postgres import TODAY

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
BEAN_COST = Decimal('1200.50')


def job(live, who='owner', **kw):
    columns = {'business_id': live.business, 'title': 'Hair and treatment', 'customer_name': 'Walk-in', **kw}
    return as_member(live, who, f'INSERT INTO jobs({",".join(columns)}) VALUES({",".join(["%s"] * len(columns))}) RETURNING id,number,status',
                     *columns.values())[0]


def line(live, job_id, item, quantity, who='owner'):
    return as_member(live, who, 'INSERT INTO job_lines(business_id,job_id,catalog_item_id,quantity) VALUES(%s,%s,%s,%s) RETURNING id',
                     live.business, job_id, item, quantity)


def finish(live, job_id, who='owner', key=None):
    data = JobComplete(request_key=key or uuid4())
    return call(live, who, lambda s, a: complete(s, a, job_id, data)), data


def test_completing_a_job_issues_its_materials_at_cost_and_locks_it(salon):
    live = salon
    as_template(live, 'editor', 'cashier')
    first = job(live, 'editor')
    assert first[1:] == ('JOB-0001', 'open') and job(live)[1] == 'JOB-0002'
    line(live, first[0], live.salon['braids'], 1, who='editor')
    line(live, first[0], live.items['Beans'], 2, who='editor')
    with pytest.raises(psycopg.errors.CheckViolation, match='ITEM_UNAVAILABLE'):
        line(live, first[0], uuid4(), 1)
    assert as_member(live, 'editor', "UPDATE jobs SET status='in_progress' WHERE id=%s RETURNING id", first[0]) == []  # cashiers open jobs, staff run them
    assert as_member(live, 'owner', "UPDATE jobs SET status='in_progress' WHERE id=%s RETURNING status", first[0]) == [('in_progress',)]
    with pytest.raises(psycopg.errors.CheckViolation, match='JOB_COMPLETED_BY_API'):
        as_member(live, 'owner', "UPDATE jobs SET status='completed' WHERE id=%s RETURNING id", first[0])
    estimate = call(live, 'owner', lambda s, a: detail(s, a, first[0]))
    assert (estimate['revenue'], estimate['materials_cost'], estimate['materials_issued']) == ('18000.00', '2401.00', False)
    on_hand, cogs, inventory = stock(live, 'Beans')[0], balance(live, '5000'), balance(live, '1200')
    done, data = finish(live, first[0])
    assert (done['status'], done['materials_cost'], done['materials_issued']) == ('completed', '2401.00', True)
    assert call(live, 'owner', lambda s, a: complete(s, a, first[0], data)) == done  # a retry completes once
    assert stock(live, 'Beans')[0] == on_hand - 2
    assert balance(live, '5000') - cogs == 2 * BEAN_COST and inventory - balance(live, '1200') == 2 * BEAN_COST
    with pytest.raises(HTTPException, match='already completed'):
        finish(live, first[0])
    with pytest.raises(psycopg.errors.CheckViolation, match='JOB_CLOSED'):
        line(live, first[0], live.salon['nails'], 1)
    short = job(live)[0]
    line(live, short, live.items['Beans'], 5)
    with pytest.raises(HTTPException, match='Only 1 x Beans in stock'):
        finish(live, short)
    with pytest.raises(psycopg.errors.CheckViolation, match='CANCEL_REASON_REQUIRED'):
        as_member(live, 'owner', "UPDATE jobs SET status='cancelled' WHERE id=%s RETURNING id", short)
    assert as_member(live, 'owner', "UPDATE jobs SET status='cancelled',cancel_reason='Customer left' WHERE id=%s RETURNING status", short) == [('cancelled',)]
    with pytest.raises(HTTPException, match='Add the services and materials'):
        finish(live, job(live)[0])
    books_balance(live)


def test_a_completed_job_is_billed_once_without_issuing_its_materials_again(salon):
    live = salon
    till = job(live)[0]
    line(live, till, live.salon['braids'], 1); line(live, till, live.items['Beans'], 1)
    finish(live, till)
    on_hand = stock(live, 'Beans')[0]
    items = [{'item_id': live.salon['braids'], 'quantity': 1, 'discount_percent': '0'}, {'item_id': live.items['Beans'], 'quantity': 1, 'discount_percent': '0'}]
    with pytest.raises(HTTPException, match="exactly the job's lines"):
        call(live, 'owner', lambda s, a: sale_create(s, a, SaleCreate(request_key=uuid4(), entry_date=TODAY, method='Cash', quoted_total='15000.00',
             job_id=till, items=items[:1])))
    cash = balance(live, '1000')
    sale = call(live, 'owner', lambda s, a: sale_create(s, a, SaleCreate(request_key=uuid4(), entry_date=TODAY, method='Cash', quoted_total='16500.00',
                job_id=till, items=items)))
    assert sale['status'] == 'completed' and balance(live, '1000') - cash == Decimal('16500')
    assert stock(live, 'Beans')[0] == on_hand  # issued when the job was completed, not again
    assert call(live, 'owner', lambda s, a: detail(s, a, till))['bill_kind'] == 'sale'
    with pytest.raises(HTTPException, match='already been billed'):
        call(live, 'owner', lambda s, a: bill_invoice(s, a, till, JobInvoice(request_key=uuid4(), customer_id=live.salon['customer'])))

    owed = job(live, customer_name=None, customer_id=live.salon['customer'])[0]
    line(live, owed, live.items['Beans'], 1)
    with pytest.raises(HTTPException, match='Complete the job before billing it'):
        call(live, 'owner', lambda s, a: bill_invoice(s, a, owed, JobInvoice(request_key=uuid4())))
    finish(live, owed)
    receivable = balance(live, '1100')
    invoiced = call(live, 'owner', lambda s, a: bill_invoice(s, a, owed, JobInvoice(request_key=uuid4())))
    assert (invoiced['total'], invoiced['invoice_number']) == ('1500.00', 'JOB-0002')
    assert balance(live, '1100') - receivable == Decimal('1500') and stock(live, 'Beans')[0] == on_hand - 1
    with pytest.raises(psycopg.errors.CheckViolation, match='JOB_COMPLETED_BY_API'):
        as_member(live, 'owner', 'UPDATE jobs SET bill_kind=NULL,bill_id=NULL,billed_at=NULL WHERE id=%s RETURNING id', owed)
    books_balance(live)


def test_job_profit_counts_materials_and_labour_at_the_owners_cost_rates_on_chairman(salon):
    live = salon
    work = job(live, staff_id=live.salon['ada'])[0]
    line(live, work, live.salon['braids'], 1); line(live, work, live.items['Beans'], 1)
    as_member(live, 'owner', 'INSERT INTO job_labour(business_id,job_id,staff_id,minutes) VALUES(%s,%s,%s,90) RETURNING id', live.business, work, live.salon['ada'])
    assert call(live, 'owner', lambda s, a: detail(s, a, work))['profit'] == {'labour_cost': '0.00', 'profit': '15299.50', 'unrated_entries': 1}
    with pytest.raises(HTTPException, match='Only the business owner'):
        call(live, 'admin', lambda s, a: save_cost_rates(s, a, CostRates(rates=[{'staff_id': live.salon['ada'], 'hourly': '2000'}])))
    assert call(live, 'owner', lambda s, a: save_cost_rates(s, a, CostRates(rates=[{'staff_id': live.salon['ada'], 'hourly': '2000'}])))['rates'] == {str(live.salon['ada']): '2000.00'}
    finish(live, work)
    assert call(live, 'owner', lambda s, a: detail(s, a, work))['profit'] == {'labour_cost': '3000.00', 'profit': '12299.50', 'unrated_entries': 0}
    as_template(live, 'editor', 'cashier')
    assert call(live, 'editor', lambda s, a: detail(s, a, work))['profit'] is None  # profit is for people who see the books
    on_plan(live, 'GROW')
    assert call(live, 'owner', lambda s, a: detail(s, a, work))['profit'] is None and call(live, 'owner', lambda s, a: cost_rates(s))['available'] is False
    with pytest.raises(HTTPException, match='Chairman plan'):
        call(live, 'owner', lambda s, a: save_cost_rates(s, a, CostRates(rates=[])))
