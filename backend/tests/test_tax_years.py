"""Tax years end on the last day of the business's year-end month."""
from datetime import date
from cacu.accounting.tax_years import period, year_of


def test_calendar_and_other_year_ends():
    assert period(2026, 12) == (date(2026, 1, 1), date(2026, 12, 31))
    assert period(2027, 3) == (date(2026, 4, 1), date(2027, 3, 31))
    assert period(2028, 2) == (date(2027, 3, 1), date(2028, 2, 29))  # a leap year
    assert period(2027, 1) == (date(2026, 2, 1), date(2027, 1, 31))
    assert (year_of(date(2026, 3, 31), 3), year_of(date(2026, 4, 1), 3), year_of(date(2026, 12, 31), 12)) == (2026, 2027, 2026)
