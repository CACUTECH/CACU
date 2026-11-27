"""Tax years (R4): the twelve months ending on the last day of the business's year-end month. Tax year Y ends in Y.
Without a setting, accounts end on 31 December and tax years are calendar years."""
from datetime import date, timedelta
from cacu.accounting.posting import raw


def year_end_month(session) -> int:
    if not raw(session, "SELECT to_regclass('accounting.tax_profile') IS NOT NULL").scalar():
        return 12
    month = raw(session, 'SELECT year_end_month FROM accounting.tax_profile WHERE business_id=%s', (str(session.business_id),)).scalar()
    return int(month) if month else 12


def period(year: int, end_month: int) -> tuple[date, date]:
    """First and last day of tax year Y."""
    end = (date(year, end_month, 28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    start = (date(year - 1, end_month, 1) + timedelta(days=32)).replace(day=1)  # the 1st of the month after last year's end
    return start, end


def year_of(day: date, end_month: int) -> int:
    """The tax year a day falls in."""
    return day.year if day.month <= end_month else day.year + 1
