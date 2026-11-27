"""Income tax in the books (27 November 2026): the Owner posts a finished year's tax (Dr Income tax expense, Cr Income
tax payable and WHT credits used), payments are recorded against it, never more than owed, and the posting (while
unpaid) or a payment can be reversed with a reason. Behind the income tax switch."""
from decimal import Decimal
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.income_tax import PayTax, PostTax, Reverse, TaxProfile, estimate, pay_tax, post_tax, reverse_tax, reverse_tax_payment, save_profile
from cacu.accounting.posting import PostingCommand, post_command
from test_fixed_assets_postgres import EARLIER_MONTH, LAST_MONTH, by_purpose, started
from test_income_tax_postgres import preview
from test_corrections_postgres import live, call, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_activation_postgres import TODAY

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
YEAR = LAST_MONTH.year  # a tax year ending last month: finished, so its tax can be posted
WHY = 'Estimate changed after review'


def finished_year(live, revenue='60000000.00'):
    started(live, EARLIER_MONTH)
    preview(live, True)
    call(live, 'owner', lambda s, a: save_profile(s, a, TaxProfile(year_end_month=LAST_MONTH.month)))
    call(live, 'owner', lambda s, a: post_command(s, a, PostingCommand(request_key=uuid4(), kind='adjustment', source_id=uuid4(),
        main_account_id=live.codes['1000'], entry_date=LAST_MONTH, narration='Sales for the year', credited=False,
        lines=[{'account_id': live.codes['4000'], 'amount': revenue, 'credited': True}])))


def payment(amount, key=None):
    return PayTax(request_key=key or uuid4(), amount=amount, entry_date=TODAY, method='Cash')


def test_the_owner_posts_a_finished_years_tax_and_pays_it(live):
    finished_year(live)
    with pytest.raises(HTTPException, match='once the year has ended'):
        call(live, 'owner', lambda s, a: post_tax(s, a, YEAR + 1, PostTax(request_key=uuid4())))
    with pytest.raises(HTTPException) as refused:
        call(live, 'admin', lambda s, a: post_tax(s, a, YEAR, PostTax(request_key=uuid4())))
    assert refused.value.status_code == 403
    view = call(live, 'owner', lambda s, a: post_tax(s, a, YEAR, PostTax(request_key=uuid4())))
    due = Decimal(view['companies_income_tax']) + Decimal(view['development_levy'])
    assert due > 0 and view['books']['posted']['payable'] == format(due, '.2f') and view['books']['outstanding'] == format(due, '.2f')
    assert by_purpose(live, 'income_tax_expense') == due and by_purpose(live, 'income_tax') == -due
    assert call(live, 'owner', lambda s, a: post_tax(s, a, YEAR, PostTax(request_key=uuid4())))['books']['posted'] == view['books']['posted']  # once

    with pytest.raises(HTTPException, match='is still owed'):
        call(live, 'admin', lambda s, a: pay_tax(s, a, YEAR, payment(format(due + 1, '.2f'))))
    key = uuid4()
    part = call(live, 'admin', lambda s, a: pay_tax(s, a, YEAR, payment('1000000.00', key)))
    assert Decimal(part['books']['outstanding']) == due - Decimal('1000000')
    assert call(live, 'admin', lambda s, a: pay_tax(s, a, YEAR, payment('1000000.00', key)))['books']['outstanding'] == part['books']['outstanding']  # retried
    with pytest.raises(HTTPException, match='Reverse them first'):
        call(live, 'owner', lambda s, a: reverse_tax(s, a, YEAR, Reverse(request_key=uuid4(), reason=WHY)))
    back = call(live, 'owner', lambda s, a: reverse_tax_payment(s, a, YEAR, key, Reverse(request_key=uuid4(), reason='Paid from the wrong account')))
    assert back['books']['outstanding'] == format(due, '.2f') and back['books']['payments'][0]['reversed'] is True
    assert by_purpose(live, 'income_tax') == -due
    preview(live, False)


def test_a_posting_with_nothing_paid_is_reversed_and_posted_again(live):
    finished_year(live)
    call(live, 'owner', lambda s, a: post_tax(s, a, YEAR, PostTax(request_key=uuid4())))
    undone = call(live, 'owner', lambda s, a: reverse_tax(s, a, YEAR, Reverse(request_key=uuid4(), reason=WHY)))
    assert undone['books']['posted'] is None and undone['books']['reversed'][0]['reason'] == WHY
    assert by_purpose(live, 'income_tax_expense') == 0 and by_purpose(live, 'income_tax') == 0
    again = call(live, 'owner', lambda s, a: post_tax(s, a, YEAR, PostTax(request_key=uuid4())))
    assert again['books']['posted'] is not None
    with psycopg.connect(URL) as c:  # both postings are kept; one is live
        assert c.execute('SELECT count(*), count(*) FILTER (WHERE reversed_at IS NULL) FROM accounting.tax_accrual WHERE business_id=%s', (live.business,)).fetchone() == (2, 1)
    preview(live, False)


def test_withholding_tax_used_is_taken_from_wht_credits(live):
    finished_year(live)
    from cacu.accounting.vat import VatSettings, save_settings
    call(live, 'owner', lambda s, a: save_settings(s, a, VatSettings(registered=True, vat_number='12345678-0001', effective_from=EARLIER_MONTH, wht_enabled=True)))
    with psycopg.connect(URL) as c:
        c.execute("""INSERT INTO accounting.wht_deduction(business_id, id, invoice_id, customer_id, amount, entry_date, certificate, created_by)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""", (live.business, uuid4(), uuid4(), uuid4(), '500000.00', LAST_MONTH, 'WHT-9', live.people['owner']))
    view = call(live, 'owner', lambda s, a: post_tax(s, a, YEAR, PostTax(request_key=uuid4())))
    assert view['books']['posted']['wht_used'] == '500000.00'
    assert by_purpose(live, 'wht_receivable') == Decimal('-500000')  # the credit is used up against the tax
    assert Decimal(view['books']['posted']['payable']) == Decimal(view['companies_income_tax']) + Decimal(view['development_levy']) - Decimal('500000')
    preview(live, False)


def test_off_until_reviewed(live):
    preview(live, False)
    with pytest.raises(HTTPException, match='not available yet'):
        call(live, 'owner', lambda s, a: post_tax(s, a, YEAR, PostTax(request_key=uuid4())))


def test_the_estimate_without_posting_says_nothing_is_in_the_books(live):
    finished_year(live, revenue='1000000.00')
    view = call(live, 'viewer', lambda s, a: estimate(s, YEAR))
    assert view['small_company'] is True and view['books'] == {'posted': None, 'payments': [], 'outstanding': None, 'reversed': []}
    with pytest.raises(HTTPException, match='no income tax or levy to post'):
        call(live, 'owner', lambda s, a: post_tax(s, a, YEAR, PostTax(request_key=uuid4())))
    preview(live, False)

