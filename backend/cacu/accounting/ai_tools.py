"""Read-only tools for the AI assistant on the books (Doc 15 "AI tools"; E18 R3; PRIN-07, ADR-009).

The model never computes or invents a figure: it asks for one of these tools, the gateway runs it through this API with
the member's own token (so the member's permissions apply exactly as on the screen), and the model explains the result.

Every tool returns the same envelope:
* ``tool``, ``period`` (start and end, or the date the position is at) and ``source``, the screen the figures come from
  (AI-002), so the answer can show the period and link to it;
* ``data``: the figures, already worked out, as strings of naira and kobo or plain counts;
* ``limitations``: what the figures cannot see (AI-003): books not started or started after the period began, transfers
  not yet confirmed, offline sales waiting for review, bank lines not yet matched. The answer must state them.

Nothing here writes (AI-006). Personal data is limited to what the question needs (AI-005): customer and supplier names
for who owes or who stopped buying, never phone numbers, emails or bank details. Names and other free text from the
books are cleaned of markup and control characters and cut short (AI-007), because they are data, not instructions.
"""
import re
import statistics
import unicodedata
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from typing import Literal
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from cacu.accounting.posting import raw

ZERO = Decimal('0')
CENT = Decimal('0.01')
NAME_LIMIT = 60
ROW_LIMIT = 20


def _money(value) -> str:
    return format(Decimal(value).quantize(CENT) + 0, '.2f')


def clean(text, limit: int = NAME_LIMIT) -> str:
    """Free text from the books as inert data: no markup, no control or format characters, one line, short."""
    value = re.sub(r'<[^>]*>', ' ', str(text or ''))
    value = ''.join(' ' if unicodedata.category(ch).startswith(('C', 'Z')) else ch for ch in value)
    value = ' '.join(value.split())
    return value[:limit].rstrip() + ('…' if len(value) > limit else '')


# ---- inputs -------------------------------------------------------------------------------------------------------

class _Input(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Period(_Input):
    start_date: date = Field(description='First day of the period, YYYY-MM-DD')
    end_date: date = Field(description='Last day of the period, YYYY-MM-DD')


class AsOf(_Input):
    as_of: date | None = Field(None, description='The date the position is at, YYYY-MM-DD; today when left out')


class Month(_Input):
    month: str = Field(pattern=r'^\d{4}-\d{2}$', description='The month, YYYY-MM')


class TopProducts(Period):
    metric: Literal['revenue', 'quantity', 'margin'] = Field('revenue', description='What to rank by')
    limit: int = Field(10, ge=1, le=ROW_LIMIT, description='How many to return, at most 20')


class TopExpenses(Period):
    limit: int = Field(5, ge=1, le=ROW_LIMIT, description='How many to return, at most 20')


class Days(_Input):
    days: int = Field(30, ge=7, le=365, description='How many days without a sale or purchase')


class Weeks(_Input):
    weeks: int = Field(4, ge=1, le=8, description='How many weeks ahead, at most 8')


# ---- what the figures cannot see (AI-003) ---------------------------------------------------------------------------

def _books_start(session) -> date | None:
    from cacu.accounting.reports import opening_transactions
    opening = opening_transactions(session)
    if not opening:
        return None
    return raw(session, 'SELECT min(transaction_date)::date FROM accounting."transaction" WHERE business_id=%s AND id = ANY(%s)',
               (str(session.business_id), list(opening))).scalar()


def limitations(session, start: date | None, end: date) -> list[str]:
    tenant = str(session.business_id)
    notes = []
    began = _books_start(session)
    if began is None:
        return ['Your books have not been started in CACU yet, so there are no figures to give.']
    if start and start < began:
        notes.append(f'Your books in CACU start on {began.isoformat()}; anything before that date is not included.')
    if end < began:
        notes.append('This period ends before your books in CACU start.')
    pending = raw(session, "SELECT count(*) AS n, coalesce(sum(amount),0) AS amount FROM accounting.pending_transfer WHERE business_id=%s AND status='pending' AND entry_date<=%s",
                  (tenant, end)).one()
    if pending.n:
        notes.append(f'{pending.n} transfer{"s" if pending.n != 1 else ""} (₦{_money(pending.amount)}) still waiting to be confirmed as received.')
    if raw(session, "SELECT to_regclass('accounting.offline_entry') IS NOT NULL").scalar():
        waiting = raw(session, "SELECT count(*) FROM accounting.offline_entry WHERE business_id=%s AND status='review'", (tenant,)).scalar()
        if waiting:
            notes.append(f'{waiting} sale{"s" if waiting != 1 else ""} made offline {"are" if waiting != 1 else "is"} waiting for review and not in these figures.')
    if raw(session, "SELECT to_regclass('accounting.bank_line') IS NOT NULL").scalar():
        unmatched = raw(session, "SELECT count(*) FROM accounting.bank_line WHERE business_id=%s AND status='unmatched' AND line_date<=%s AND (%s::date IS NULL OR line_date>=%s)",
                        (tenant, end, start, start)).scalar()
        if unmatched:
            notes.append(f'{unmatched} bank statement line{"s" if unmatched != 1 else ""} in this period {"are" if unmatched != 1 else "is"} not yet matched to your books.')
    return notes


def _envelope(tool, period, source, data, notes):
    return {'tool': tool, 'period': period, 'source': source, 'data': data, 'limitations': notes,
            'label': 'From your CACU books, not reviewed'}


def _period(start, end):
    return {'start_date': start.isoformat(), 'end_date': end.isoformat()}


def _today(session):
    from cacu.accounting.workflows import business_today
    return business_today(session)


def _may(session, permission) -> bool:
    return bool(raw(session, 'SELECT authz.has_permission(%s, %s)', (str(session.business_id), permission)).scalar())


# ---- the tools ---------------------------------------------------------------------------------------------------

def profit_summary(session, p: Period):
    from cacu.accounting.reports import statements
    report = statements(session, p.start_date, p.end_date, 'prior')
    sections = {s['key']: s['total'] for s in report['income_statement']['sections']}
    pair = lambda values: {'this_period': values[0], 'previous_period': values[1]}
    data = {'revenue': pair(sections['revenue']), 'cost_of_sales': pair(sections['cost_of_sales']),
            'gross_profit': pair(report['income_statement']['gross_profit']), 'operating_expenses': pair(sections['operating_expenses']),
            'other_income': pair(sections['other_income']), 'other_expenses': pair(sections['other_expenses']),
            'net_profit': pair(report['income_statement']['net_profit']), 'previous_period': report['periods'][1]}
    notes = limitations(session, p.start_date, p.end_date) + [e['message'] for e in report['exceptions']]
    return _envelope('profit_summary', _period(p.start_date, p.end_date), {'screen': 'Reports', 'path': '/reports'}, data, notes)


def _cash_rows(session, end):
    from cacu.accounting.reports import ledger_rows, opening_transactions
    names = dict(raw(session, 'SELECT id::text, name FROM public.accounts WHERE business_id=%s', (str(session.business_id),)).all())
    rows = [r for r in ledger_rows(session, end) if r['flow_section'] == 'cash']
    return rows, names, opening_transactions(session)


def _movements(rows, opening, start, end):
    """Money in and out of cash and bank between two dates, by transaction; moves between your own accounts net to nothing."""
    per = defaultdict(lambda: ZERO)
    for r in rows:
        day = r['transaction_date'].date()
        if start <= day <= end and r['transaction_id'] not in opening:
            per[r['transaction_id']] += r['amount'] * (1 if r['entry_type'] == 'DEBIT' else -1)
    return sum((v for v in per.values() if v > 0), ZERO), -sum((v for v in per.values() if v < 0), ZERO)


def cash_position(session, p: AsOf):
    as_of = p.as_of or _today(session)
    rows, names, opening = _cash_rows(session, as_of)
    balances, earlier = defaultdict(lambda: ZERO), ZERO
    month_ago = as_of - timedelta(days=30)
    for r in rows:
        signed = r['amount'] * (1 if r['entry_type'] == 'DEBIT' else -1)
        balances[str(r['source_account_id'])] += signed
        if r['transaction_date'].date() <= month_ago:
            earlier += signed
    money_in, money_out = _movements(rows, opening, month_ago + timedelta(days=1), as_of)
    pending = raw(session, "SELECT count(*) AS n, coalesce(sum(amount),0) AS amount FROM accounting.pending_transfer WHERE business_id=%s AND status='pending' AND entry_date<=%s",
                  (str(session.business_id), as_of)).one()
    total = sum(balances.values(), ZERO)
    data = {'accounts': [{'name': clean(names.get(k, 'Cash or bank account')), 'balance': _money(v)} for k, v in sorted(balances.items(), key=lambda kv: -kv[1]) if v],
            'total': _money(total), 'thirty_days_before': {'date': month_ago.isoformat(), 'total': _money(earlier)},
            'last_thirty_days': {'money_in': _money(money_in), 'money_out': _money(money_out), 'change': _money(total - earlier)},
            'pending_transfers': {'count': pending.n, 'amount': _money(pending.amount)}}
    return _envelope('cash_position', {'as_of': as_of.isoformat()}, {'screen': 'Balance Sheet', 'path': '/reports'}, data,
                     limitations(session, month_ago, as_of))


def top_products(session, p: TopProducts):
    from cacu.accounting.profitability import report
    result = report(session, p.start_date, p.end_date)
    with_cost = _may(session, 'ledger.view')  # cost and margin are ledger figures; a sales-only member sees sales
    if p.metric == 'margin' and not with_cost:
        raise HTTPException(403, 'Margins need permission to view the books')
    key = {'revenue': lambda i: Decimal(i['revenue']), 'quantity': lambda i: i['quantity'],
           'margin': lambda i: Decimal(i['margin']) if i['margin'] is not None else Decimal('-1e9')}[p.metric]
    ranked = sorted(result['items'], key=lambda i: (-key(i), i['name']))[:p.limit]
    rows = [{'name': clean(i['name']), 'kind': i['kind'], 'quantity': i['quantity'], 'revenue': i['revenue'],
             **({'cost': i['cost'], 'profit': i['profit'], 'margin_percent': i['margin']} if with_cost else {})} for i in ranked]
    totals = {'revenue': result['totals']['revenue'], **({'profit': result['totals']['profit']} if with_cost else {})}
    return _envelope('top_products', _period(p.start_date, p.end_date), {'screen': 'Profitability', 'path': '/analytics/profitability'},
                     {'ranked_by': p.metric, 'items': rows, 'all_sales': totals}, limitations(session, p.start_date, p.end_date))


def slow_stock(session, p: Days):
    today = _today(session)
    since = today - timedelta(days=p.days)
    tenant = str(session.business_id)
    rows = raw(session, """SELECT c.name, v.quantity, v.gross_cost, (SELECT max(e.created_at)::date FROM accounting.stock_event e
          WHERE e.business_id=v.business_id AND e.item_id=v.item_id AND e.quantity<0 AND EXISTS (SELECT FROM accounting.document_map d
            WHERE d.business_id=e.business_id AND d.source_id=e.source_id AND d.source_type IN ('pos','invoice'))) AS last_sold
        FROM accounting.inventory_valuation v JOIN public.catalog_items c ON c.business_id=v.business_id AND c.id=v.item_id
        WHERE v.business_id=%s AND v.quantity>0""", (tenant,)).all()
    slow = sorted((r for r in rows if r.last_sold is None or r.last_sold < since), key=lambda r: (-Decimal(r.gross_cost), r.name))
    items = [{'name': clean(r.name), 'quantity': int(r.quantity), 'value_at_cost': _money(r.gross_cost),
              'last_sold': r.last_sold.isoformat() if r.last_sold else None} for r in slow[:ROW_LIMIT]]
    data = {'days_without_sale': p.days, 'items': items, 'count': len(slow), 'value_at_cost': _money(sum((Decimal(r.gross_cost) for r in slow), ZERO))}
    notes = limitations(session, since, today)
    untracked = raw(session, """SELECT count(*) FROM public.catalog_items c WHERE c.business_id=%s AND coalesce(c.stock_quantity,0)>0
        AND NOT EXISTS (SELECT FROM accounting.inventory_valuation v WHERE v.business_id=c.business_id AND v.item_id=c.id)""", (tenant,)).scalar()
    if untracked:
        notes.append(f'{untracked} item{"s" if untracked != 1 else ""} in stock {"have" if untracked != 1 else "has"} no cost recorded in the books yet and {"are" if untracked != 1 else "is"} not included.')
    return _envelope('slow_stock', {'start_date': since.isoformat(), 'end_date': today.isoformat()}, {'screen': 'Inventory', 'path': '/inventory'}, data, notes)


def top_expenses(session, p: TopExpenses):
    from cacu.accounting.reports import statements
    report = statements(session, p.start_date, p.end_date)
    sections = {s['key']: s for s in report['income_statement']['sections']}
    lines = [l for k in ('operating_expenses', 'other_expenses') for l in sections[k]['lines']]
    ranked = sorted(lines, key=lambda l: (-Decimal(l['amounts'][0]), l['name']))[:p.limit]
    total = sum((Decimal(l['amounts'][0]) for l in lines), ZERO)
    data = {'expenses': [{'name': clean(l['name']), 'amount': l['amounts'][0]} for l in ranked if Decimal(l['amounts'][0])], 'all_expenses': _money(total)}
    return _envelope('top_expenses', _period(p.start_date, p.end_date), {'screen': 'Reports', 'path': '/reports'}, data,
                     limitations(session, p.start_date, p.end_date) + [e['message'] for e in report['exceptions']])


def receivables(session, p: AsOf):
    from cacu.accounting.receivables import ageing
    as_of = p.as_of or _today(session)
    owed = ageing(session, 'receivables', as_of)
    overdue = lambda r: sum((Decimal(r[k]) for k in ('d1_30', 'd31_60', 'd61_90', 'over_90')), ZERO)
    rows = [{'customer': clean(r['name']), 'owes': r['net'], 'not_yet_due': r['current'], 'overdue': _money(overdue(r)),
             'overdue_over_60_days': _money(Decimal(r['d61_90']) + Decimal(r['over_90'])), 'invoices': len(r['documents'])}
            for r in owed['rows'] if Decimal(r['net']) > 0]
    t = owed['totals']
    data = {'customers': rows[:ROW_LIMIT], 'customer_count': len(rows),
            'totals': {'owed': t['net'], 'not_yet_due': t['current'], 'overdue_1_30_days': t['d1_30'], 'overdue_31_60_days': t['d31_60'],
                       'overdue_61_90_days': t['d61_90'], 'overdue_over_90_days': t['over_90'], 'paid_in_advance': t['advance']}}
    return _envelope('receivables', {'as_of': as_of.isoformat()}, {'screen': 'Ageing', 'path': '/analytics/aging-reports'}, data,
                     limitations(session, None, as_of))


def lapsed_customers(session, p: Days):
    from cacu.accounting.crm import _facts
    customers, today = _facts(session)
    lapsed = sorted((c for c in customers if c['last'] and (today - c['last']).days >= p.days), key=lambda c: (c['last'], c['name']))
    rows = [{'customer': clean(c['name']), 'last_purchase': c['last'].isoformat(), 'days_since': (today - c['last']).days,
             'spent_before': _money(sum((v for _, v in c['purchases']), ZERO))} for c in lapsed[:ROW_LIMIT]]
    notes = limitations(session, None, today) + ['Only invoiced purchases are linked to a customer; till sales without a customer are not counted.']
    return _envelope('lapsed_customers', {'as_of': today.isoformat()}, {'screen': 'Customer segments', 'path': '/customers/segments'},
                     {'no_purchase_for_days': p.days, 'customers': rows, 'count': len(lapsed)}, notes)


def budget_variance(session, p: Month):
    from cacu.accounting.budgets import against_actual
    from cacu.accounting.periods import _month, month_end
    month = _month(p.month)
    result = against_actual(session, p.month)
    pick = lambda f: {k: f[k] for k in ('budget', 'actual', 'difference', 'percent', 'on_track')}
    data = {'has_budget': result['has_budget'], 'year_from': result['year_from'],
            'accounts': [{'name': clean(l['name']), 'kind': l['kind'], 'month': pick(l['month']), 'year_to_date': pick(l['year_to_date'])} for l in result['lines']][:ROW_LIMIT * 2],
            'totals': {k: {span: pick(v[span]) for span in ('month', 'year_to_date')} for k, v in result['totals'].items()}}
    notes = limitations(session, month, month_end(month))
    if not result['has_budget']:
        notes.insert(0, 'No budget has been set for this year, so there is nothing to compare against.')
    return _envelope('budget_variance', _period(month, month_end(month)), {'screen': 'Budget against actual', 'path': '/analytics/budget-vs-actual'}, data, notes)


def cash_forecast(session, p: Weeks):
    from cacu.accounting.receivables import ageing
    today = _today(session)
    rows, _, opening = _cash_rows(session, today)
    began = _books_start(session) or today
    window_start = max(today - timedelta(days=83), began)
    days = (today - window_start).days + 1
    money_in, money_out = _movements(rows, opening, window_start, today)
    weekly_in, weekly_out = (money_in * 7 / days).quantize(CENT), (money_out * 7 / days).quantize(CENT)
    cash = sum((r['amount'] * (1 if r['entry_type'] == 'DEBIT' else -1) for r in rows), ZERO)
    horizon = today + timedelta(weeks=p.weeks)

    def due(kind):
        total = ZERO
        for r in ageing(session, kind, today)['rows']:
            total += sum((Decimal(d['outstanding']) for d in r['documents'] if date.fromisoformat(d['due_date']) <= horizon), ZERO)
        return total
    weeks = [{'week_ending': (today + timedelta(weeks=k)).isoformat(), 'projected_cash': _money(cash + k * (weekly_in - weekly_out))} for k in range(1, p.weeks + 1)]
    data = {'cash_now': _money(cash), 'average_week': {'money_in': _money(weekly_in), 'money_out': _money(weekly_out), 'net': _money(weekly_in - weekly_out)},
            'weeks': weeks, 'customers_owe_due_by_then': _money(due('receivables')), 'you_owe_suppliers_due_by_then': _money(due('payables')),
            'method': (f'Cash now, plus the average weekly money in and out over the last {days} days, carried forward week by week. '
                       'What customers owe and what you owe suppliers by then are shown separately and not added in, because the averages '
                       'already include past collections and payments. This is a simple estimate, not a promise.')}
    notes = limitations(session, window_start, today)
    if days < 28:
        notes.append(f'The averages come from only {days} days of books, so the estimate is rough.')
    return _envelope('cash_forecast', {'start_date': today.isoformat(), 'end_date': horizon.isoformat()}, {'screen': 'Cash Flow Statement', 'path': '/reports'}, data, notes)


def unusual(amount: Decimal, pattern: list[Decimal]) -> bool:
    """More than two standard deviations above the average of the months before; when those months were flat, the
    deviation counts as at least a tenth of the average, so a flat pattern still needs a rise of more than 20%."""
    mean = sum(pattern, ZERO) / len(pattern)
    spread = Decimal(str(statistics.pstdev([float(x) for x in pattern])))
    return amount > 0 and amount > mean + 2 * max(spread, mean * Decimal('0.1'))


def unusual_spending(session, p: Month):
    from cacu.accounting.budgets import _accounts, _actuals
    from cacu.accounting.periods import _month, month_end
    month = _month(p.month)
    before = []
    m = month
    for _ in range(3):
        m = (m - timedelta(days=1)).replace(day=1)
        before.append(m)
    began = _books_start(session)
    notes = limitations(session, before[-1], month_end(month))
    flagged = []
    if began is None or began > before[-1]:
        # Months before the books began are not a pattern of zero spending; they are unknown.
        notes.append('Your books need three full months before this month to see a pattern, so nothing is compared yet.')
    else:
        this = _actuals(session, month, month_end(month))
        history = [_actuals(session, b, month_end(b)) for b in before]
        for a in _accounts(session):
            if a['kind'] != 'expense' or a['type'] == 'DIRECT_EXPENSE':
                continue  # cost of goods sold follows sales; it is not spending to question
            amount = this.get(a['id'], ZERO)
            pattern = [h.get(a['id'], ZERO) for h in history]
            mean = sum(pattern, ZERO) / 3
            if unusual(amount, pattern):
                flagged.append({'name': clean(a['name']), 'this_month': _money(amount), 'three_month_average': _money(mean),
                                'above_average_by': _money(amount - mean), 'previous_months': [_money(x) for x in reversed(pattern)]})
        flagged.sort(key=lambda f: -Decimal(f['above_average_by']))
    data = {'months_compared': [b.strftime('%Y-%m') for b in reversed(before)], 'unusual': flagged[:ROW_LIMIT],
            'method': 'An expense is unusual when this month is more than two standard deviations above its average for the three months before '
                      '(and at least 20% above that average when the earlier months were flat). Cost of goods sold is left out because it follows sales.'}
    return _envelope('unusual_spending', _period(month, month_end(month)), {'screen': 'Reports', 'path': '/reports'}, data, notes)


# ---- the catalogue -----------------------------------------------------------------------------------------------

TOOLS = {
    'profit_summary': ('ledger.view', Period, profit_summary, 'Revenue, cost of sales, expenses and profit for a period, with the period before'),
    'cash_position': ('ledger.view', AsOf, cash_position, 'Cash and bank balances at a date, transfers not yet confirmed, and the last 30 days'),
    'top_products': ('sales.view', TopProducts, top_products, 'Products and services ranked by revenue, quantity or margin for a period'),
    'slow_stock': ('inventory.view', Days, slow_stock, 'Stock that has not sold for a number of days, with its quantity and value at cost'),
    'top_expenses': ('ledger.view', TopExpenses, top_expenses, 'The largest expenses for a period'),
    'receivables': ('invoices.view', AsOf, receivables, 'Which customers owe money at a date and how long it is overdue'),
    'lapsed_customers': ('customers.view', Days, lapsed_customers, 'Customers who have not bought for a number of days'),
    'budget_variance': ('ledger.view', Month, budget_variance, 'Budget against actual for a month and the year to date'),
    'cash_forecast': ('ledger.view', Weeks, cash_forecast, 'A simple cash forecast for up to 8 weeks, with its method stated'),
    'unusual_spending': ('ledger.view', Month, unusual_spending, 'Expenses in a month well above their pattern over the three months before'),
}


def permission_for(tool: str) -> str:
    if tool not in TOOLS:
        raise HTTPException(404, 'Unknown tool')
    return TOOLS[tool][0]


def run(session, tool: str, params: dict):
    _, model, fn, _ = TOOLS[tool]
    try:
        inputs = model(**params)
    except ValidationError as error:
        raise HTTPException(422, 'Invalid tool input: ' + '; '.join(f"{'.'.join(map(str, e['loc']))} {e['msg']}" for e in error.errors())) from None
    if isinstance(inputs, Period):
        from cacu.accounting.reports import validate_dates
        validate_dates(inputs.start_date, inputs.end_date)
    return fn(session, inputs)


def catalogue(session):
    """The tools this member may use, with their inputs as JSON Schema: the gateway offers only these to the model."""
    return {'tools': [{'name': name, 'description': description, 'permission': permission, 'parameters': model.model_json_schema()}
                      for name, (permission, model, _, description) in TOOLS.items() if _may(session, permission)]}
