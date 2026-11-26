"""Funding readiness, part 1 (Doc 15 FR-180..185 and FRA-001..012; E19 R3): eligibility, the score and its explanation.

The score is a weighted sum of seven dimensions, each 0 to 100, worked out by fixed rules from the business's own posted
books. Nothing is learned or estimated, so every point can be explained (FRA-001). The weights and thresholds come
from the model version stored in accounting.funding_model, and each assessment records that version (FRA-004).

It is off until gate G5 (accounting.funding_switch) and follows the plan's module.funding entitlement (FRA-005).
The notice in NOTICE appears with every result (FRA-009). The score uses only the business's financial records:
never the owner's personal characteristics, location or any protected attribute (FRA-011).
"""
from datetime import date, datetime, time, timedelta
from decimal import Decimal, ROUND_HALF_UP
from statistics import mean, pstdev
from fastapi import HTTPException
from cacu.accounting.posting import raw

ZERO = Decimal('0')
HUNDRED = Decimal('100')
NOTICE = ('This is an indicative self-assessment based on your CACU records. '
          'It is not a credit rating, credit report or offer of finance.')
LIMITATIONS = [
    'The score reflects only what is recorded in CACU.',
    'Cash kept outside CACU, informal loans and unrecorded sales are invisible to it.',
    'Six months is a short history.',
    'Seasonal businesses may score lower on consistency through no fault of their own.',
]
BANDS = {
    'strong': ('Strong', 'Your records and results are in good shape for a funding conversation.'),
    'developing': ('Developing', 'A few areas to improve before approaching a lender.'),
    'early': ('Early', 'Build more consistent records and results first.'),
    'not_yet_ready': ('Not yet ready', 'Focus on the steps below for the next 3 months.'),
}
DIMENSIONS = [
    ('D1', 'Record completeness and quality', ('days_recorded', 'open_exceptions')),
    ('D2', 'Revenue consistency', ('revenue_cv',)),
    ('D3', 'Revenue trend', ('revenue_growth',)),
    ('D4', 'Profitability', ('net_margin', 'profitable_months')),
    ('D5', 'Cash-flow stability', ('positive_cash_months', 'cash_cover_days')),
    ('D6', 'Debt service capacity', ('debt_cover',)),
    ('D7', 'Receivables and concentration', ('overdue_60_share', 'top_customer_share')),
]
MEASURES = {
    'days_recorded': ('Trading days with something recorded', 'percent'),
    'open_exceptions': ('Open exceptions: unmatched bank lines, transfers waiting over 7 days, offline entries to review, books checks failing', 'count'),
    'revenue_cv': ('How much monthly revenue varies (coefficient of variation)', 'ratio'),
    'revenue_growth': ('Revenue in the last 3 months against the 3 before', 'percent'),
    'net_margin': ('Net profit as a share of revenue', 'percent'),
    'profitable_months': ('Months with a profit', 'percent'),
    'positive_cash_months': ('Months where day-to-day trading brought cash in', 'percent'),
    'cash_cover_days': ('Lowest cash and bank balance, in days of average spending', 'days'),
    'debt_cover': ('Monthly cash from trading against monthly loan repayments', 'ratio'),
    'overdue_60_share': ('Share of what customers owe that is over 60 days old', 'percent'),
    'top_customer_share': ('Share of sales from the biggest customer', 'percent'),
}
EXPENSE_TYPES = {'OPERATING_EXPENSE', 'DIRECT_EXPENSE', 'OVERHEAD_EXPENSE', 'OTHER_EXPENSE'}
PROFIT_TYPES = EXPENSE_TYPES | {'OPERATING_REVENUE', 'NON_OPERATING_REVENUE'}
LOAN_TYPES = {'NON_CURRENT_LIABILITY', 'CURRENT_LIABILITY'}


def _d(value) -> Decimal:
    return value if isinstance(value, Decimal) else Decimal(str(value))


def _round(value: Decimal, places='0.01') -> Decimal:
    return value.quantize(Decimal(places), rounding=ROUND_HALF_UP)


# --- The score: pure functions of the figures and the model -----------------------------------------------------

def scale(value: Decimal, best: Decimal, worst: Decimal) -> Decimal:
    """0 at the worst value, 100 at the best, a straight line between, clipped (Doc 15 "Normalisation")."""
    if best == worst:
        raise ValueError('A measure needs different best and worst values')
    position = (value - worst) / (best - worst) * HUNDRED
    return min(max(position, ZERO), HUNDRED)


def band(score: int, model: dict) -> str:
    return next(b['band'] for b in model['bands'] if score >= b['from'])


def score(figures: dict, model: dict) -> dict:
    """The assessment from the figures. A figure that is None could not be worked out from the books. A dimension
    with no figures at all is left out and its weight shared out among the rest ("based on 6 of 7 dimensions").
    D6 with no loan repayments uses Doc 15's stated rule: 100 with positive cash from trading, otherwise 0."""
    dimensions = []
    for key, label, measures in DIMENSIONS:
        rows = []
        for m in measures:
            limits = model['measures'][m]
            value = figures.get(m)
            row = {'key': m, 'label': MEASURES[m][0], 'unit': MEASURES[m][1], 'best': limits['best'], 'worst': limits['worst'],
                   'value': None if value is None else format(_round(_d(value)), 'f'), 'score': None, 'note': None}
            if value is not None:
                row['score'] = int(_round(scale(_d(value), _d(limits['best']), _d(limits['worst'])), '1'))
            elif m == 'debt_cover' and figures.get('no_debt') and figures.get('average_operating_cash') is not None:
                row['score'] = 100 if _d(figures['average_operating_cash']) > 0 else 0
                row['note'] = ('No loan repayments recorded, and trading brought cash in.' if row['score'] else
                               'No loan repayments recorded, but trading did not bring cash in.')
            else:
                row['note'] = 'Not enough in the books to work this out.'
            rows.append(row)
        scored = [r['score'] for r in rows if r['score'] is not None]
        dimensions.append({'key': key, 'label': label, 'weight': model['weights'][key],
                           'score': int(_round(_d(mean(scored)), '1')) if scored else None, 'measures': rows})
    used = [d for d in dimensions if d['score'] is not None]
    if not used:
        raise HTTPException(409, 'There is not enough in the books yet to work out a score.')
    total_weight = sum(d['weight'] for d in used)
    overall = int(_round(sum(_d(d['score']) * d['weight'] for d in used) / total_weight, '1'))
    for d in dimensions:
        d['share'] = format(_round(_d(d['weight']) * HUNDRED / total_weight, '0.1'), 'f') if d['score'] is not None else None
    chosen = band(overall, model)
    return {'score': overall, 'band': chosen, 'band_label': BANDS[chosen][0], 'band_text': BANDS[chosen][1],
            'based_on': len(used), 'dimensions': dimensions}


# --- Dates ----------------------------------------------------------------------------------------------------------

def _month_start(day: date) -> date:
    return day.replace(day=1)


def _add_months(month: date, count: int) -> date:
    index = month.year * 12 + month.month - 1 + count
    return date(index // 12, index % 12 + 1, 1)


def _month_end(month: date) -> date:
    return _add_months(month, 1) - timedelta(days=1)


def first_full_month(cutover: date) -> date:
    return cutover if cutover.day == 1 else _add_months(_month_start(cutover), 1)


def period(cutover: date, today: date, model: dict) -> tuple[date, date, int]:
    """The full months to assess: up to the last model['period_months'] ended before this month, from the first full
    month of the books. Returns the start, the end and how many full months there are."""
    first, this_month = first_full_month(cutover), _month_start(today)
    full = max((this_month.year - first.year) * 12 + this_month.month - first.month, 0)
    months = min(full, model['period_months'])
    end = this_month - timedelta(days=1)
    return _add_months(this_month, -months), end, months


# --- Figures from the books ---------------------------------------------------------------------------------------

def _model(session, version: str | None = None) -> tuple[str, dict]:
    row = raw(session, 'SELECT version, definition FROM accounting.funding_model WHERE (%s::text IS NULL OR version=%s) ORDER BY created_at DESC, version DESC LIMIT 1',
              (version, version)).first()
    if row is None:
        raise HTTPException(503, 'Funding readiness is not set up.')
    return row.version, row.definition


def access(session) -> dict:
    value = raw(session, 'SELECT accounting.funding_access(%s)', (str(session.business_id),)).scalar() or {}
    return {'enabled': value.get('enabled') is True, 'level': value.get('level') or 'false'}


def _cutover(session):
    return raw(session, "SELECT cutover_date FROM accounting.business_map WHERE business_id=%s AND state='active'",
               (str(session.business_id),)).scalar()


def exceptions(session, today: date, older_than_days: int = 0) -> dict:
    """What still needs sorting out. With older_than_days, only what has waited longer than that (eligibility, FR-180);
    the books checks count whenever they fail, since they mean the books do not agree with themselves."""
    from cacu.accounting.reports import trial_balance
    from cacu.accounting.transfers import list_transfers
    tenant, cutoff = str(session.business_id), today - timedelta(days=older_than_days)
    bank = raw(session, "SELECT count(*) FROM accounting.bank_line WHERE business_id=%s AND status='unmatched' AND line_date<=%s",
               (tenant, cutoff)).scalar()
    offline = raw(session, "SELECT count(*) FROM accounting.offline_entry WHERE business_id=%s AND status='review' AND received_at::date<=%s",
                  (tenant, cutoff)).scalar()
    waiting = sum(1 for t in list_transfers(session, 'pending') if t['age_days'] > max(7, older_than_days))
    checks = [e['message'] for e in trial_balance(session, today)['exceptions']]
    return {'bank_lines': int(bank), 'transfers': waiting, 'offline': int(offline), 'books_checks': checks,
            'total': int(bank) + waiting + int(offline) + len(checks)}


def eligibility(session, today: date, model: dict) -> dict:
    """FR-180: books active for at least 6 full months (an approved opening position starts them), and nothing that
    needs sorting out older than 30 days. If not, what is missing and the earliest date the business can qualify."""
    rules = model['eligibility']
    cutover = _cutover(session)
    if cutover is None:
        return {'eligible': False, 'earliest_date': None,
                'missing': [{'key': 'books', 'message': 'Start your books in CACU and approve the opening position first.'}]}
    missing = []
    earliest = _add_months(first_full_month(cutover), rules['full_months'])
    _, _, months = period(cutover, today, model)
    if months < rules['full_months']:
        missing.append({'key': 'history', 'message': f"Your books need {rules['full_months']} full months in CACU; they have {months} so far."})
    old = exceptions(session, today, rules['exception_age_days'])
    age = rules['exception_age_days']
    if old['bank_lines']:
        missing.append({'key': 'bank_lines', 'message': f"Match or explain the {old['bank_lines']} bank statement line{'s' if old['bank_lines'] != 1 else ''} older than {age} days."})
    if old['transfers']:
        missing.append({'key': 'transfers', 'message': f"Confirm or clear the {old['transfers']} transfer{'s' if old['transfers'] != 1 else ''} waiting more than {age} days."})
    if old['offline']:
        missing.append({'key': 'offline', 'message': f"Review the {old['offline']} offline entr{'ies' if old['offline'] != 1 else 'y'} waiting more than {age} days."})
    for message in old['books_checks']:
        missing.append({'key': 'books_checks', 'message': f'Fix this before assessing: {message}.'})
    return {'eligible': not missing, 'missing': missing,
            'earliest_date': earliest.isoformat() if months < rules['full_months'] else None}


def _days_recorded(session, start: date, end: date, opening: set) -> Decimal | None:
    """Trading days (Monday to Saturday in version 1) with at least one entry posted, as a share of trading days."""
    days = {r.day for r in raw(session, """SELECT DISTINCT t.transaction_date::date AS day, t.id FROM accounting."transaction" t
        WHERE t.business_id=%s AND t.transaction_date>=%s AND t.transaction_date<%s""",
        (str(session.business_id), datetime.combine(start, time.min), datetime.combine(end + timedelta(days=1), time.min))).all()
        if r.id not in opening}
    trading = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    trading = [d for d in trading if d.weekday() < 6]
    if not trading:
        return None
    return Decimal(sum(1 for d in trading if d in days)) * HUNDRED / len(trading)


def _top_customer(session, start: date, end: date, opening: set) -> Decimal | None:
    """The biggest customer's share of till sales and invoices in the period (walk-in sales have no customer)."""
    rows = raw(session, """SELECT coalesce(i.customer_id, s.customer_id)::text AS customer, d.transaction_id,
          coalesce(i.total - coalesce((to_jsonb(i)->>'credited_total')::numeric, 0), s.total, 0) AS value
        FROM accounting.document_map d JOIN accounting."transaction" t ON t.id=d.transaction_id AND t.business_id=d.business_id
        LEFT JOIN public.invoices i ON d.source_type='invoice' AND i.business_id=d.business_id AND i.id=d.source_id
        LEFT JOIN public.transactions s ON d.source_type='pos' AND s.business_id=d.business_id AND s.id=d.source_id
        WHERE d.business_id=%s AND d.source_type IN ('pos','invoice') AND coalesce(i.status, '') <> 'void'
          AND t.transaction_date>=%s AND t.transaction_date<%s""",
               (str(session.business_id), datetime.combine(start, time.min), datetime.combine(end + timedelta(days=1), time.min))).all()
    total, by = ZERO, {}
    for r in rows:
        if r.transaction_id in opening:
            continue
        total += Decimal(r.value)
        if r.customer:
            by[r.customer] = by.get(r.customer, ZERO) + Decimal(r.value)
    if total <= 0:
        return None
    return (max(by.values()) if by else ZERO) * HUNDRED / total


def figures(session, start: date, end: date, today: date) -> tuple[dict, dict]:
    """Every measure Doc 15 names, from the posted books for the full months start..end. Returns the figures for
    score() and information that is shown but not scored (stock turnover for product businesses)."""
    from cacu.accounting.reports import cash_flow, ledger_rows, opening_transactions
    from cacu.accounting.receivables import ageing
    opening = opening_transactions(session)
    months = []
    month = start
    while month <= end:
        months.append(month)
        month = _add_months(month, 1)
    revenue = {m: ZERO for m in months}
    profit = {m: ZERO for m in months}
    spending, repayments, cost_of_sales = ZERO, ZERO, ZERO
    cash_moves, stock_moves = {}, {}
    cash_before, stock_before = ZERO, ZERO
    for row in ledger_rows(session, end):
        day = row['transaction_date'].date()
        signed = Decimal(row['amount']) * (1 if row['entry_type'] == 'DEBIT' else -1)
        if row['flow_section'] == 'cash':
            if day < start:
                cash_before += signed
            else:
                cash_moves[day] = cash_moves.get(day, ZERO) + signed
        if row['purpose'] == 'inventory':
            if day < start:
                stock_before += signed
            else:
                stock_moves[day] = stock_moves.get(day, ZERO) + signed
        if day < start or row['transaction_id'] in opening:
            continue
        m = _month_start(day)
        if row['account_type'] == 'OPERATING_REVENUE':
            revenue[m] -= signed
        if row['account_type'] in PROFIT_TYPES:
            profit[m] -= signed
        if row['account_type'] in EXPENSE_TYPES:
            spending += signed
        if row['account_type'] == 'DIRECT_EXPENSE':
            cost_of_sales += signed
        if row['account_type'] in LOAN_TYPES and row['flow_section'] == 'financing' and row['entry_type'] == 'DEBIT':
            repayments += Decimal(row['amount'])

    out = {}
    series = [revenue[m] for m in months]
    out['days_recorded'] = _days_recorded(session, start, end, opening)
    out['open_exceptions'] = Decimal(exceptions(session, today)['total'])
    average = Decimal(mean(series)) if series else ZERO
    out['revenue_cv'] = Decimal(pstdev(series)) / average if len(series) >= 3 and average > 0 else None
    if len(series) >= 6 and sum(series[-6:-3]) > 0:
        out['revenue_growth'] = (sum(series[-3:]) - sum(series[-6:-3])) / sum(series[-6:-3]) * HUNDRED
    else:
        out['revenue_growth'] = None
    total_revenue, total_profit = sum(series, ZERO), sum(profit.values(), ZERO)
    out['net_margin'] = total_profit / total_revenue * HUNDRED if total_revenue > 0 else None
    out['profitable_months'] = Decimal(sum(1 for m in months if profit[m] > 0)) * HUNDRED / len(months) if months else None

    # Cash from day-to-day trading, month by month (the operating section of the cash-flow statement).
    try:
        operating = [Decimal(next(s['total'] for s in cash_flow(session, m, _month_end(m))['sections'] if s['key'] == 'operating')) for m in months]
    except HTTPException:
        operating = None  # the cash-flow statement cannot be drawn up until every account has a reviewed mapping
    out['positive_cash_months'] = Decimal(sum(1 for v in operating if v > 0)) * HUNDRED / len(operating) if operating else None
    days = (end - start).days + 1
    balance, lowest = cash_before, None
    for i in range(days):
        balance += cash_moves.get(start + timedelta(days=i), ZERO)
        lowest = balance if lowest is None else min(lowest, balance)
    daily_spending = spending / days if days else ZERO
    out['cash_cover_days'] = lowest / daily_spending if daily_spending > 0 and lowest is not None else None
    out['average_operating_cash'] = Decimal(mean(operating)) if operating else None
    monthly_repayments = repayments / len(months) if months else ZERO
    out['no_debt'] = monthly_repayments == 0
    out['debt_cover'] = out['average_operating_cash'] / monthly_repayments if monthly_repayments > 0 and out['average_operating_cash'] is not None else None

    owed = ageing(session, 'receivables', end)['totals']
    gross = sum((Decimal(owed[k]) for k in ('current', 'd1_30', 'd31_60', 'd61_90', 'over_90')), ZERO)
    out['overdue_60_share'] = (Decimal(owed['d61_90']) + Decimal(owed['over_90'])) * HUNDRED / gross if gross > 0 else ZERO
    out['top_customer_share'] = _top_customer(session, start, end, opening)

    information = {}
    kind = raw(session, 'SELECT business_type FROM public.businesses WHERE id=%s', (str(session.business_id),)).scalar()
    if kind in {'PRODUCT', 'HYBRID'}:
        level, ends = stock_before, []
        for m in months:
            for i in range((_month_end(m) - m).days + 1):
                level += stock_moves.get(m + timedelta(days=i), ZERO)
            ends.append(level)
        average_stock = Decimal(mean(ends)) if ends else ZERO
        if average_stock > 0:
            information['stock_turnover'] = {'label': 'Times your stock was sold and replaced over the period (shown, not scored)',
                                             'value': format(_round(cost_of_sales / average_stock, '0.1'), 'f')}
    return out, information


# --- What the API serves ------------------------------------------------------------------------------------------

def _available(session) -> dict:
    state = access(session)
    if not state['enabled']:
        return {**state, 'available': False, 'message': 'Funding readiness is not available yet.'}
    if state['level'] not in {'score', 'improvement_plan', 'lender_pack'}:
        return {**state, 'available': False, 'message': 'Your plan does not include funding readiness.'}
    return {**state, 'available': True, 'message': None}


def _serialise(row) -> dict:
    return {**row.result, 'id': str(row.id), 'assessed_on': row.assessed_on.isoformat(), 'created_at': row.created_at.isoformat()}


def _latest(session):
    return raw(session, 'SELECT * FROM accounting.funding_assessment WHERE business_id=%s ORDER BY created_at DESC LIMIT 1',
               (str(session.business_id),)).first()


def overview(session) -> dict:
    """Whether it is available, whether the business qualifies (and if not, what is missing), and the latest result."""
    from cacu.accounting.workflows import business_today
    state = _available(session)
    out = {'available': state['available'], 'level': state['level'], 'message': state['message'], 'notice': NOTICE,
           'limitations': LIMITATIONS, 'eligibility': None, 'latest': None, 'assessed_today': False}
    if not state['available']:
        return out
    today = business_today(session)
    _, model = _model(session)
    out['eligibility'] = eligibility(session, today, model)
    latest = _latest(session)
    if latest is not None:
        out['latest'] = _serialise(latest)
        out['assessed_today'] = latest.assessed_on == today and latest.kind == 'request'
    return out


def assess(session, actor) -> dict:
    """An assessment on request, at most once a day (FRA-003): a second request the same day returns the first."""
    from cacu.accounting.workflows import business_today
    state = _available(session)
    if not state['available']:
        raise HTTPException(409, state['message'])
    today = business_today(session)
    existing = raw(session, "SELECT * FROM accounting.funding_assessment WHERE business_id=%s AND kind='request' AND assessed_on=%s",
                   (str(session.business_id), today)).first()
    if existing is not None:
        return _serialise(existing)
    version, model = _model(session)
    checked = eligibility(session, today, model)
    if not checked['eligible']:
        raise HTTPException(409, ' '.join(m['message'] for m in checked['missing']))
    start, end, months = period(_cutover(session), today, model)
    values, information = figures(session, start, end, today)
    result = {**score(values, model), 'model_version': version, 'notice': NOTICE, 'limitations': LIMITATIONS,
              'period': {'start_date': start.isoformat(), 'end_date': end.isoformat(), 'months': months},
              'information': information, 'label': 'From your CACU books, not reviewed'}
    import json
    row = raw(session, """INSERT INTO accounting.funding_assessment(business_id, model_version, kind, assessed_on, period_start, period_end,
          score, band, result, requested_by) VALUES (%s,%s,'request',%s,%s,%s,%s,%s,%s::jsonb,%s)
        ON CONFLICT (business_id, kind, assessed_on) DO NOTHING RETURNING *""",
              (str(session.business_id), version, today, start, end, result['score'], result['band'], json.dumps(result), str(actor))).first()
    if row is None:  # another request the same day got there first
        row = raw(session, "SELECT * FROM accounting.funding_assessment WHERE business_id=%s AND kind='request' AND assessed_on=%s",
                  (str(session.business_id), today)).first()
    return _serialise(row)
