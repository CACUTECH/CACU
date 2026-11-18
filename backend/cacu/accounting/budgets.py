"""Budgets and budget against actual (Doc 03 FR-137, FR-145; Doc 11 R3; Doc 10 E14 R3 part 3).

One budget per financial year (the year starts in the month set for the books): an amount for each income and expense
account in each of its twelve months. The report compares a month and the year to date with what the ledger shows:
income above budget is good, spending above budget is not. Accounts with neither a budget nor any activity are left out.
"""
import json
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from uuid import UUID, uuid4
from fastapi import HTTPException
from pydantic import BaseModel, Field, field_validator
from cacu.accounting.posting import raw

ZERO = Decimal('0')
AMOUNT = r'^[0-9]{1,13}(\.[0-9]{1,2})?$'


class BudgetLine(BaseModel):
    account_id: UUID
    months: list[str] = Field(min_length=12, max_length=12)

    @field_validator('months')
    @classmethod
    def amounts(cls, values):
        import re
        if any(not re.fullmatch(AMOUNT, v) for v in values):
            raise ValueError('Each month is an amount of zero or more, with at most two decimal places')
        return values


class BudgetSave(BaseModel):
    lines: list[BudgetLine] = Field(max_length=500)


def _year_start(session) -> int:
    return int(raw(session, 'SELECT year_start FROM accounting.entity WHERE id=%s AND business_id=%s',
                   (session.entity.id, str(session.business_id))).scalar() or 1)


def months_of(session, fiscal_year: int) -> list[date]:
    start = _year_start(session)
    first = date(fiscal_year, start, 1)
    out, month = [], first
    for _ in range(12):
        out.append(month)
        month = (month.replace(day=28) + timedelta(days=4)).replace(day=1)
    return out


def fiscal_year_of(session, day: date) -> int:
    start = _year_start(session)
    return day.year if day.month >= start else day.year - 1


def _accounts(session):
    """The income and expense accounts of the chart, in code order."""
    rows = raw(session, """SELECT a.id::text AS id, a.code, a.name, n.account_type::text AS type FROM accounting.account_map m
        JOIN public.accounts a ON a.id=m.account_id AND a.business_id=m.business_id
        JOIN accounting.account n ON n.id=m.library_id AND n.business_id=m.business_id
        WHERE m.business_id=%s ORDER BY a.code, a.name""", (str(session.business_id),)).mappings().all()
    return [dict(r, kind='income' if r['type'].endswith('REVENUE') else 'expense') for r in rows
            if r['type'].endswith('REVENUE') or r['type'].endswith('EXPENSE')]


def budget(session, fiscal_year: int):
    months = months_of(session, fiscal_year)
    saved = raw(session, 'SELECT updated_at FROM accounting.budget WHERE business_id=%s AND fiscal_year=%s',
                (str(session.business_id), fiscal_year)).first()
    amounts = defaultdict(lambda: [ZERO] * 12)
    for r in raw(session, 'SELECT account_id::text, month, amount FROM accounting.budget_line WHERE business_id=%s AND fiscal_year=%s',
                 (str(session.business_id), fiscal_year)).all():
        amounts[r.account_id][months.index(r.month)] = r.amount
    accounts = [{**a, 'months': [format(v, '.2f') for v in amounts[a['id']]], 'total': format(sum(amounts[a['id']], ZERO), '.2f')}
                for a in _accounts(session)]
    return {'fiscal_year': fiscal_year, 'months': [m.isoformat() for m in months], 'saved_at': saved.updated_at.isoformat() if saved else None,
            'accounts': accounts}


def save(session, actor, fiscal_year: int, data: BudgetSave):
    from cacu.accounting.workflows import role
    if role(session, actor) not in {'owner', 'admin'}:
        raise HTTPException(403, 'Only the business owner or an Admin can set the budget.')
    if not 2000 <= fiscal_year <= 2100:
        raise HTTPException(422, 'Choose a year between 2000 and 2100.')
    known = {a['id'] for a in _accounts(session)}
    ids = [str(l.account_id) for l in data.lines]
    if len(set(ids)) != len(ids):
        raise HTTPException(422, 'Each account appears once in a budget.')
    if any(i not in known for i in ids):
        raise HTTPException(422, 'Budgets are set for income and expense accounts of your chart.')
    months = months_of(session, fiscal_year)
    tenant = str(session.business_id)
    raw(session, """INSERT INTO accounting.budget(business_id,fiscal_year,updated_by) VALUES(%s,%s,%s)
        ON CONFLICT (business_id,fiscal_year) DO UPDATE SET updated_by=EXCLUDED.updated_by,updated_at=now()""", (tenant, fiscal_year, str(actor)))
    raw(session, 'DELETE FROM accounting.budget_line WHERE business_id=%s AND fiscal_year=%s', (tenant, fiscal_year))
    for line in data.lines:
        for month, amount in zip(months, line.months):
            if Decimal(amount) > 0:
                raw(session, 'INSERT INTO accounting.budget_line(business_id,fiscal_year,account_id,month,amount) VALUES(%s,%s,%s,%s,%s)',
                    (tenant, fiscal_year, str(line.account_id), month, Decimal(amount)))
    total = sum((Decimal(a) for l in data.lines for a in l.months), ZERO)
    raw(session, 'INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,%s,%s::jsonb)',
        (tenant, str(actor), str(uuid4()), 'budget_saved', json.dumps({'fiscal_year': fiscal_year, 'accounts': len(data.lines), 'total': format(total, '.2f')})))
    return budget(session, fiscal_year)


def _actuals(session, start: date, end: date):
    """Each income and expense account's movement between start and end: income as earned, expenses as spent."""
    rows = raw(session, """SELECT m.account_id::text AS id, n.account_type::text AS type,
        coalesce(sum(CASE WHEN l.entry_type::text='DEBIT' THEN l.amount ELSE -l.amount END),0) AS debit
        FROM accounting.ledger l JOIN accounting.account n ON n.id=l.post_account_id AND n.business_id=l.business_id
        JOIN accounting.account_map m ON m.library_id=n.id AND m.business_id=l.business_id
        WHERE l.business_id=%s AND l.transaction_date>=%s AND l.transaction_date<%s GROUP BY 1,2""",
                (str(session.business_id), datetime.combine(start, time.min), datetime.combine(end + timedelta(days=1), time.min))).all()
    return {r.id: (-Decimal(r.debit) if r.type.endswith('REVENUE') else Decimal(r.debit)) for r in rows}


def against_actual(session, month_value: str):
    """A month and the financial year to date: budget, actual and the difference for each account, and the totals."""
    from cacu.accounting.periods import _month, month_end
    month = _month(month_value)
    year = fiscal_year_of(session, month)
    months = months_of(session, year)
    budgeted = defaultdict(lambda: defaultdict(lambda: ZERO))
    for r in raw(session, 'SELECT account_id::text, month, amount FROM accounting.budget_line WHERE business_id=%s AND fiscal_year=%s',
                 (str(session.business_id), year)).all():
        budgeted[r.account_id][r.month] = r.amount
    has_budget = bool(budgeted)  # before the lookups below, which add empty entries to the defaultdict
    in_month, to_date = _actuals(session, month, month_end(month)), _actuals(session, months[0], month_end(month))
    upto = [m for m in months if m <= month]

    def figures(kind, budget_amount, actual):
        difference = actual - budget_amount
        good = difference >= 0 if kind == 'income' else difference <= 0
        return {'budget': format(budget_amount, '.2f'), 'actual': format(actual, '.2f'), 'difference': format(difference, '.2f'),
                'percent': format((actual / budget_amount * 100).quantize(Decimal('1')), 'f') if budget_amount else None, 'on_track': good}

    lines, totals = [], {k: {'month': [ZERO, ZERO], 'year': [ZERO, ZERO]} for k in ('income', 'expense')}
    for a in _accounts(session):
        b_month = budgeted[a['id']][month]
        b_year = sum((budgeted[a['id']][m] for m in upto), ZERO)
        act_month, act_year = in_month.get(a['id'], ZERO), to_date.get(a['id'], ZERO)
        if not any((b_month, b_year, act_month, act_year)):
            continue
        totals[a['kind']]['month'][0] += b_month; totals[a['kind']]['month'][1] += act_month
        totals[a['kind']]['year'][0] += b_year; totals[a['kind']]['year'][1] += act_year
        lines.append({'account_id': a['id'], 'code': a['code'], 'name': a['name'], 'kind': a['kind'],
                      'month': figures(a['kind'], b_month, act_month), 'year_to_date': figures(a['kind'], b_year, act_year)})

    def profit(span):
        b = totals['income'][span][0] - totals['expense'][span][0]
        act = totals['income'][span][1] - totals['expense'][span][1]
        return figures('income', b, act)
    return {'month': month.isoformat(), 'fiscal_year': year, 'year_from': months[0].isoformat(),
            'has_budget': has_budget, 'lines': lines,
            'totals': {kind: {'month': figures(kind, *totals[kind]['month']), 'year_to_date': figures(kind, *totals[kind]['year'])} for kind in ('income', 'expense')}
                      | {'profit': {'month': profit('month'), 'year_to_date': profit('year')}}}
