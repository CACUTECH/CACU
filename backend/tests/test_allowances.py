"""Capital allowances arithmetic (Nigeria Tax Act 2025 as CACU reads it): straight-line on cost by class, a full year
from the year bought and none in the year of disposal, 1% kept until disposal, and the balancing figure on disposal."""
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from cacu.accounting.allowances import DEFAULT_CLASS, computation


def asset(cost='1000000.00', start=date(2026, 3, 1), disposed_on=None, proceeds=None):
    return SimpleNamespace(cost=Decimal(cost), depreciate_from=start, disposed_on=disposed_on,
                           disposal_proceeds=Decimal(proceeds) if proceeds is not None else None)


def test_a_25_percent_asset_is_allowed_over_four_years_keeping_one_percent():
    van = asset()
    years = [computation(van, Decimal('0.25'), Decimal('0'), y) for y in range(2026, 2032)]
    assert [y['allowance'] for y in years] == [Decimal('250000.00')] * 3 + [Decimal('240000.00'), Decimal('0'), Decimal('0')]
    assert years[3]['closing'] == Decimal('10000.00') and years[5]['closing'] == Decimal('10000.00')  # 1% kept until disposal
    assert computation(van, Decimal('0.25'), Decimal('0'), 2025) is None  # not yet bought


def test_disposal_gives_no_allowance_that_year_and_a_balancing_figure():
    sold = asset(disposed_on=date(2028, 6, 30), proceeds='600000.00')
    year = computation(sold, Decimal('0.20'), Decimal('0'), 2028)
    assert (year['opening'], year['allowance'], year['balancing'], year['closing']) == (Decimal('600000.00'), Decimal('0'), Decimal('0.00'), Decimal('0'))
    charged = computation(asset(disposed_on=date(2028, 6, 30), proceeds='700000.00'), Decimal('0.20'), Decimal('0'), 2028)
    assert charged['balancing'] == Decimal('100000.00')  # proceeds above the tax written-down value: taxable
    assert computation(sold, Decimal('0.20'), Decimal('0'), 2029) is None


def test_an_asset_owned_before_cacu_carries_what_was_already_claimed():
    old = asset(cost='500000.00', start=date(2026, 1, 1))
    years = [computation(old, Decimal('0.10'), Decimal('400000.00'), y) for y in (2026, 2027, 2028)]
    assert years[0]['opening'] == Decimal('100000.00')
    assert [y['allowance'] for y in years] == [Decimal('50000.00'), Decimal('45000.00'), Decimal('0')]  # up to 99% in all
    assert years[2]['closing'] == Decimal('5000.00')


def test_every_asset_category_has_a_default_class():
    assert set(DEFAULT_CLASS) == {'buildings', 'vehicles', 'machinery', 'furniture', 'computers', 'other'}


def test_a_march_year_end_moves_the_first_allowance_year():
    laptop = asset(start=date(2026, 5, 1))
    assert computation(laptop, Decimal('0.20'), Decimal('0'), 2026, end_month=3) is None  # bought after the year to March 2026
    assert computation(laptop, Decimal('0.20'), Decimal('0'), 2027, end_month=3)['allowance'] == Decimal('200000.00')


def test_an_asset_bought_before_2026_starts_in_2026_with_what_was_claimed_under_the_old_law():
    van = SimpleNamespace(cost=Decimal('10000000.00'), acquired_on=date(2025, 10, 1), depreciate_from=date(2025, 10, 1), disposed_on=None, disposal_proceeds=None)
    assert computation(van, Decimal('0.25'), Decimal('0'), 2025) is None  # no allowance under this Act before 2026
    year = computation(van, Decimal('0.25'), Decimal('2500000.00'), 2026)
    assert (year['opening'], year['allowance']) == (Decimal('7500000.00'), Decimal('2500000.00'))
