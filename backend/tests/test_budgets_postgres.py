"""Budgets and budget against actual (Doc 03 FR-137, FR-145; Doc 10 E14 R3 part 3): one budget per financial year, an
amount for each income and expense account each month; the report compares the month and the year to date with the
ledger, income above budget being good and spending above budget not."""
from decimal import Decimal
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.budgets import BudgetSave, against_actual, budget, fiscal_year_of, months_of, save
from cacu.accounting.periods import month_start
from cacu.accounting.workflows import expense_create, sale_create
from test_corrections_postgres import live, call, expense, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_activation_postgres import TODAY
from test_pos_checkout_postgres import sale

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
THIS = month_start(TODAY)


def plan(live, year, **amounts):
    """amounts: account code -> amount for every month."""
    return BudgetSave(lines=[{'account_id': live.codes[code], 'months': [amount] * 12} for code, amount in amounts.items()])


def test_a_budget_has_an_amount_per_account_per_month_and_only_owners_and_admins_set_it(live):
    year = call(live, 'viewer', lambda s, a: fiscal_year_of(s, TODAY))
    empty = call(live, 'viewer', lambda s, a: budget(s, year))
    assert empty['saved_at'] is None and len(empty['months']) == 12 and empty['months'][0] == f'{year}-01-01'  # the year starts in January here
    codes = {a['code']: a for a in empty['accounts']}
    assert codes['4000']['kind'] == 'income' and codes['6200']['kind'] == 'expense' and '1000' not in codes and '2000' not in codes
    with pytest.raises(HTTPException, match='owner or an Admin'):
        call(live, 'editor', lambda s, a: save(s, a, year, plan(live, year, **{'4000': '5000.00'})))
    with pytest.raises(HTTPException, match='income and expense accounts'):
        call(live, 'owner', lambda s, a: save(s, a, year, plan(live, year, **{'1000': '5000.00'})))
    with pytest.raises(ValueError):
        plan(live, year, **{'4000': '-1'})
    saved = call(live, 'admin', lambda s, a: save(s, a, year, plan(live, year, **{'4000': '5000.00', '6200': '20000.00'})))
    lines = {a['code']: a for a in saved['accounts']}
    assert saved['saved_at'] and lines['4000']['total'] == '60000.00' and lines['6200']['months'][0] == '20000.00'
    again = call(live, 'owner', lambda s, a: save(s, a, year, plan(live, year, **{'6200': '15000.00'})))  # a save replaces the budget
    assert {a['code']: a['total'] for a in again['accounts']}['4000'] == '0.00'
    assert [m for m in call(live, 'viewer', lambda s, a: months_of(s, year))][-1].month == 12


def test_budget_against_actual_for_the_month_and_the_year_to_date(live):
    year = call(live, 'viewer', lambda s, a: fiscal_year_of(s, TODAY))
    assert call(live, 'viewer', lambda s, a: against_actual(s, THIS.strftime('%Y-%m')))['has_budget'] is False  # nothing saved yet
    call(live, 'owner', lambda s, a: save(s, a, year, plan(live, year, **{'4000': '2000.00', '6200': '10000.00'})))
    call(live, 'owner', lambda s, a: sale_create(s, a, sale(live, lines=(('Beans', 2, '0'),))))  # ₦3,000 of sales
    call(live, 'owner', lambda s, a: expense_create(s, a, expense(live, amount='15000.00')))     # ₦15,000 on diesel
    report = call(live, 'viewer', lambda s, a: against_actual(s, THIS.strftime('%Y-%m')))
    lines = {l['code']: l for l in report['lines']}
    assert report['has_budget'] and report['fiscal_year'] == year
    sales, diesel = lines['4000']['month'], lines['6200']['month']
    assert (sales['budget'], sales['actual'], sales['difference'], sales['percent'], sales['on_track']) == ('2000.00', '3000.00', '1000.00', '150', True)
    assert (diesel['budget'], diesel['actual'], diesel['difference'], diesel['on_track']) == ('10000.00', '15000.00', '5000.00', False)  # overspent
    months_so_far = THIS.month  # the year started in January
    assert lines['6200']['year_to_date']['budget'] == format(Decimal('10000.00') * months_so_far, '.2f')
    profit = report['totals']['profit']['month']
    assert (profit['budget'], profit['actual'], profit['on_track']) == ('-8000.00', '-14401.00', False)  # cost of the beans counts too
    assert '5000' in lines  # cost of the beans sold: no budget, but it moved, so it is shown
    assert all(l['code'] != '6100' for l in report['lines'])  # rent: no budget and no activity
    with pytest.raises(HTTPException, match='YYYY-MM'):
        call(live, 'viewer', lambda s, a: against_actual(s, 'November'))
