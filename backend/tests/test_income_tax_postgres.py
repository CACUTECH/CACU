"""Company income tax estimate (R4; Nigeria Tax Act 2025): small companies pay nothing; others pay 30% on total profits
and the 4% development levy on assessable profits; adjustments and losses brought forward change it; nothing posts.
Off until reviewed, on for CACU's preview business."""
from decimal import Decimal
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.income_tax import Adjustment, TaxYear, add_adjustment, estimate, remove_adjustment, save_year
from cacu.accounting.posting import PostingCommand, post_command
from test_corrections_postgres import live, call, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_activation_postgres import TODAY

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
YEAR = TODAY.year


def preview(live, on):
    with psycopg.connect(URL) as c:
        c.execute('UPDATE accounting.income_tax_switch SET enabled=false')
        c.execute('DELETE FROM accounting.preview_business')
        if on:
            c.execute("INSERT INTO accounting.preview_business(business_id, reason) VALUES (%s, 'CACU preview')", (live.business,))


def sell(live, amount):
    """Revenue for the year, as a journal into the till."""
    call(live, 'owner', lambda s, a: post_command(s, a, PostingCommand(request_key=uuid4(), kind='adjustment', source_id=uuid4(),
        main_account_id=live.codes['1000'], entry_date=TODAY, narration='Sales for the year', credited=False,
        lines=[{'account_id': live.codes['4000'], 'amount': amount, 'credited': True}])))


def step(view, label):
    return Decimal(next((s['amount'] for s in view['steps'] if s['label'] == label), '0'))


def ledger_rows(live):
    with psycopg.connect(URL) as c:
        return c.execute('SELECT count(*) FROM accounting.ledger WHERE business_id=%s', (live.business,)).fetchone()[0]


def test_off_until_reviewed(live):
    preview(live, False)
    with pytest.raises(HTTPException, match='not available yet'):
        call(live, 'owner', lambda s, a: estimate(s, YEAR))


def test_a_small_company_pays_nothing_and_a_larger_one_pays_tax_and_levy(live):
    preview(live, True)
    small = call(live, 'viewer', lambda s, a: estimate(s, YEAR))
    assert small['small_company'] is True and small['total_due'] == '0.00' and small['small_turnover'] == '50000000.00'

    sell(live, '60000000.00')
    view = call(live, 'viewer', lambda s, a: estimate(s, YEAR))
    assert view['small_company'] is False and 'turnover is above ₦50,000,000' in view['not_small_because']
    total, assessable = Decimal(view['steps'][-1]['amount']), step(view, 'Assessable profit')
    assert view['steps'][-1]['label'] == 'Total profits' and assessable > 0
    assert Decimal(view['companies_income_tax']) == (total * Decimal('0.30')).quantize(Decimal('0.01'))
    assert Decimal(view['development_levy']) == (assessable * Decimal('0.04')).quantize(Decimal('0.01'))
    assert view['reviewed'] is False
    preview(live, False)


def test_adjustments_and_losses_change_the_estimate_and_nothing_posts(live):
    preview(live, True)
    sell(live, '60000000.00')
    before = call(live, 'viewer', lambda s, a: estimate(s, YEAR))
    rows = ledger_rows(live)
    with pytest.raises(HTTPException) as refused:
        call(live, 'editor', lambda s, a: save_year(s, a, YEAR, TaxYear(professional_services=True)))
    assert refused.value.status_code == 403

    fine = uuid4()
    added = call(live, 'owner', lambda s, a: add_adjustment(s, a, YEAR, Adjustment(request_key=fine, direction='add', label='LASG fine', amount='1000000.00')))
    assert step(added, 'Adjusted profit') == step(before, 'Adjusted profit') + Decimal('1000000')
    again = call(live, 'owner', lambda s, a: add_adjustment(s, a, YEAR, Adjustment(request_key=fine, direction='add', label='LASG fine', amount='1000000.00')))
    assert len(again['adjustments']) == 1  # a retried request adds nothing

    with_losses = call(live, 'admin', lambda s, a: save_year(s, a, YEAR, TaxYear(losses_brought_forward='5000000.00')))
    assert step(with_losses, 'Assessable profit') == max(step(added, 'Adjusted profit') - Decimal('5000000'), Decimal('0'))
    removed = call(live, 'owner', lambda s, a: remove_adjustment(s, a, YEAR, fine))
    assert removed['adjustments'] == []

    professional = call(live, 'owner', lambda s, a: save_year(s, a, YEAR, TaxYear(professional_services=True)))
    assert 'the business provides professional services' in professional['not_small_because']
    assert ledger_rows(live) == rows  # an estimate, never a posting
    with pytest.raises(HTTPException, match='starts with 2026'):
        call(live, 'viewer', lambda s, a: estimate(s, 2025))
    preview(live, False)
