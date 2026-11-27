"""Stock and job times carry a zone: a day's profitability starts at midnight in the business's own timezone, so a sale
just after midnight in Lagos counts its cost on the same day as its revenue."""
from datetime import date, datetime, timezone
from types import SimpleNamespace
from cacu.accounting.profitability import _moments


def test_a_lagos_day_starts_at_lagos_midnight():
    since, until = _moments(SimpleNamespace(business_timezone='Africa/Lagos'), date(2026, 11, 27), date(2026, 11, 27))
    assert since.astimezone(timezone.utc) == datetime(2026, 11, 26, 23, 0, tzinfo=timezone.utc)
    assert until.astimezone(timezone.utc) == datetime(2026, 11, 27, 23, 0, tzinfo=timezone.utc)
    sold = datetime(2026, 11, 26, 23, 30, tzinfo=timezone.utc)  # 00:30 on the 27th in Lagos
    assert since <= sold < until
