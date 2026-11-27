"""Year-end close (R4; owner decision of 27 November 2026).

Once every month of a financial year is closed, the Owner closes the year. It is then locked: none of its months can be
reopened until the year itself is reopened, by the Owner with a reason (only the latest closed year). The statement of
financial position shows the profit of closed years as retained earnings and only the open year's as profit for the
year. Nothing posts to the ledger, so every report keeps reconciling with the accounting library.

Financial years end on the business's year-end month (accounting.tax_profile; 31 December unless set) and close in
order, from the year the books started.
"""
import json
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from uuid import uuid4
from fastapi import HTTPException
from pydantic import BaseModel, Field
from cacu.accounting.posting import raw

ZERO = Decimal('0')
PROFIT_TYPES = ('OPERATING_REVENUE', 'NON_OPERATING_REVENUE', 'OPERATING_EXPENSE', 'DIRECT_EXPENSE', 'OVERHEAD_EXPENSE', 'OTHER_EXPENSE')


class ReopenYear(BaseModel):
    reason: str = Field(min_length=5, max_length=500)


def _available(session) -> bool:
    return bool(raw(session, "SELECT to_regclass('accounting.year_close') IS NOT NULL").scalar())


def closed_years(session) -> list:
    """The years closed now, oldest first."""
    if not _available(session):
        return []
    return raw(session, 'SELECT * FROM accounting.year_close WHERE business_id=%s AND reopened_at IS NULL ORDER BY end_date', (str(session.business_id),)).all()


def closed_through(session, day: date) -> date | None:
    """The end of the latest closed year on or before day: the profit up to it is retained earnings."""
    ends = [y.end_date for y in closed_years(session) if y.end_date <= day]
    return max(ends) if ends else None


def in_closed_year(session, day: date) -> bool:
    return any(y.start_date <= day <= y.end_date for y in closed_years(session))


def _profit(session, start: date, end: date) -> Decimal:
    return -Decimal(raw(session, """SELECT coalesce(sum(CASE WHEN l.entry_type::text='DEBIT' THEN l.amount ELSE -l.amount END),0)
        FROM accounting.ledger l JOIN accounting.account a ON a.id=l.post_account_id AND a.business_id=l.business_id
        WHERE l.business_id=%s AND l.transaction_date>=%s AND l.transaction_date<%s AND a.account_type::text = ANY(%s)""",
        (str(session.business_id), datetime.combine(start, time.min), datetime.combine(end + timedelta(days=1), time.min), list(PROFIT_TYPES))).scalar())


def _years(session):
    """Every financial year from the one the books started in to the one in progress: (year, start, end)."""
    from cacu.accounting.periods import _first_month
    from cacu.accounting.tax_years import period, year_end_month, year_of
    from cacu.accounting.workflows import business_today
    end_month = year_end_month(session)
    first, last = year_of(_first_month(session), end_month), year_of(business_today(session), end_month)
    return [(y, *period(y, end_month)) for y in range(first, last + 1)]


def overview(session) -> list[dict]:
    from cacu.accounting.periods import _first_month, _rows, month_start, next_month
    from cacu.accounting.workflows import business_today
    if not _available(session):
        return []
    today, first, rows = business_today(session), _first_month(session), _rows(session)
    closed = {y.year: y for y in closed_years(session)}
    out = []
    for year, start, end in _years(session):
        month, open_months = max(month_start(start), first), []
        while month <= end:
            if month < month_start(today) and (rows.get(month) is None or rows[month].status != 'closed'):
                open_months.append(month.isoformat())
            month = next_month(month)
        row = closed.get(year)
        out.append({'year': year, 'start': start.isoformat(), 'end': end.isoformat(), 'status': 'closed' if row else 'open',
                    'ended': end < today, 'months_open': open_months,
                    'profit': format(row.profit, '.2f') if row else None, 'closed_at': row.closed_at.isoformat() if row else None})
    return list(reversed(out))


def close_year(session, actor, year: int) -> list[dict]:
    from cacu.accounting.workflows import role
    if role(session, actor) != 'owner':
        raise HTTPException(403, 'Only the business owner can close a year.')
    years = {y['year']: y for y in overview(session)}
    found = years.get(year)
    if found is None:
        raise HTTPException(404, 'That year is not in your books.')
    if found['status'] == 'closed':
        return list(years.values())
    if not found['ended']:
        raise HTTPException(409, 'A year closes only once it has ended.')
    if found['months_open']:
        raise HTTPException(409, f"Close every month of the year first: {date.fromisoformat(found['months_open'][0]):%B %Y} is still open.")
    earlier = [y for y in years.values() if y['year'] < year and y['status'] != 'closed']
    if earlier:
        raise HTTPException(409, f"Close {min(y['year'] for y in earlier)} first: years close in order.")
    start, end = date.fromisoformat(found['start']), date.fromisoformat(found['end'])
    profit = _profit(session, start, end)
    raw(session, 'INSERT INTO accounting.year_close(business_id, year, start_date, end_date, profit, closed_by) VALUES (%s,%s,%s,%s,%s,%s)',
        (str(session.business_id), year, start, end, profit, str(actor)))
    raw(session, 'INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,%s,%s::jsonb)',
        (str(session.business_id), str(actor), str(uuid4()), 'year_closed', json.dumps({'year': year, 'profit': format(profit, '.2f')})))
    return overview(session)


def reopen_year(session, actor, year: int, data: ReopenYear) -> list[dict]:
    from cacu.accounting.workflows import role
    if role(session, actor) != 'owner':
        raise HTTPException(403, 'Only the business owner can reopen a year.')
    live = closed_years(session)
    row = next((y for y in live if y.year == year), None)
    if row is None:
        raise HTTPException(409, 'This year is not closed.')
    if any(y.end_date > row.end_date for y in live):
        raise HTTPException(409, 'Reopen the later years first. Only the latest closed year can be reopened.')
    reason = ' '.join(data.reason.split())
    raw(session, 'UPDATE accounting.year_close SET reopened_at=now(), reopen_reason=%s, reopened_by=%s WHERE business_id=%s AND id=%s',
        (reason, str(actor), str(session.business_id), str(row.id)))
    raw(session, 'INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,%s,%s::jsonb)',
        (str(session.business_id), str(actor), str(uuid4()), 'year_reopened', json.dumps({'year': year, 'reason': reason})))
    return overview(session)
