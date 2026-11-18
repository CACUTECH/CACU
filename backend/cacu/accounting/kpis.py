"""Key performance indicators (Doc 18 R3 "E16 rest"; Doc 12 SCR-18; Doc 05 BO-03 "owners understand performance").

Each figure comes from the posted books, for the period chosen and the period of the same length before it:
revenue, gross profit and margin, operating expenses, net profit, how many sales and invoices there were and their
average value; and at the period's end: cash and bank, what customers owe (and how much is overdue), what is owed to
suppliers, and stock value. Nothing is estimated: a figure the books cannot give is not shown (Doc 05 BO-04).
"""
from decimal import Decimal
from cacu.accounting.posting import raw

ZERO = Decimal('0')


def _money(v):
    return format(Decimal(v).quantize(Decimal('0.01')), '.2f')


def _change(now: Decimal, before: Decimal):
    if before == 0:
        return None
    return format(((now - before) / abs(before) * 100).quantize(Decimal('1')), 'f')


def _sales(session, start, end):
    """Till sales and invoices dated in the period (not the opening balances)."""
    from datetime import datetime, time, timedelta
    from cacu.accounting.reports import opening_transactions
    opening = opening_transactions(session)
    rows = raw(session, """SELECT d.transaction_id FROM accounting.document_map d JOIN accounting."transaction" t ON t.id=d.transaction_id AND t.business_id=d.business_id
        WHERE d.business_id=%s AND d.source_type IN ('pos','invoice') AND t.transaction_date>=%s AND t.transaction_date<%s""",
               (str(session.business_id), datetime.combine(start, time.min), datetime.combine(end + timedelta(days=1), time.min))).all()
    return sum(1 for r in rows if r.transaction_id not in opening)


def kpis(session, start, end):
    from cacu.accounting.reports import statements
    from cacu.accounting.receivables import ageing
    report = statements(session, start, end, 'prior')
    sections = {s['key']: s for s in report['income_statement']['sections']}
    pick = lambda key, i: Decimal(sections[key]['total'][i])
    figures = []

    def add(key, label, now, before, kind='money', good='up'):
        figures.append({'key': key, 'label': label, 'value': _money(now) if kind == 'money' else str(now),
                        'previous': (_money(before) if kind == 'money' else str(before)) if before is not None else None,
                        'change': _change(Decimal(now), Decimal(before)) if before is not None else None, 'kind': kind, 'good': good})
    revenue = [pick('revenue', i) for i in (0, 1)]
    gross = [Decimal(g) for g in report['income_statement']['gross_profit']]
    net = [Decimal(n) for n in report['income_statement']['net_profit']]
    spending = [pick('operating_expenses', i) for i in (0, 1)]
    prior = report['periods'][1]
    from datetime import date
    counts = [_sales(session, start, end), _sales(session, date.fromisoformat(prior['start_date']), date.fromisoformat(prior['end_date']))]
    add('revenue', 'Revenue', revenue[0], revenue[1])
    add('gross_profit', 'Gross profit', gross[0], gross[1])
    margins = [(g / r * 100).quantize(Decimal('1')) if r else None for g, r in zip(gross, revenue)]
    if margins[0] is not None:
        figures.append({'key': 'gross_margin', 'label': 'Gross margin', 'value': f'{margins[0]}', 'previous': f'{margins[1]}' if margins[1] is not None else None,
                        'change': None, 'kind': 'percent', 'good': 'up'})
    add('operating_expenses', 'Operating expenses', spending[0], spending[1], good='down')
    add('net_profit', 'Net profit', net[0], net[1])
    add('sales', 'Sales and invoices', counts[0], counts[1], kind='count')
    averages = [(r / c).quantize(Decimal('0.01')) if c else None for r, c in zip(revenue, counts)]
    if averages[0] is not None:
        add('average_sale', 'Average sale', averages[0], averages[1])

    position = {s['key']: s for s in report['financial_position']['sections']}
    cash = sum((Decimal(l['amounts'][0]) for l in position['current_assets']['lines']
                if l['account_id'] and raw(session, "SELECT purpose IN ('cash','bank') FROM accounting.account_map WHERE business_id=%s AND account_id=%s",
                                           (str(session.business_id), l['account_id'])).scalar()), ZERO)
    stock = sum((Decimal(l['amounts'][0]) for l in position['current_assets']['lines']
                 if l['account_id'] and raw(session, "SELECT purpose='inventory' FROM accounting.account_map WHERE business_id=%s AND account_id=%s",
                                            (str(session.business_id), l['account_id'])).scalar()), ZERO)
    owed = ageing(session, 'receivables', end)
    overdue = sum((Decimal(owed['totals'][k]) for k in ('d1_30', 'd31_60', 'd61_90', 'over_90')), ZERO)
    owing = ageing(session, 'payables', end)
    at_end = [{'key': 'cash', 'label': 'Cash and bank', 'value': _money(cash)},
              {'key': 'receivables', 'label': 'Customers owe you', 'value': owed['totals']['net'], 'detail': f'{_money(overdue)} overdue' if overdue else 'Nothing overdue'},
              {'key': 'payables', 'label': 'You owe suppliers', 'value': owing['totals']['total']},
              {'key': 'stock', 'label': 'Stock at cost', 'value': _money(stock)}]
    return {'period': report['periods'][0], 'previous_period': prior, 'label': report['tier'], 'exceptions': report['exceptions'],
            'figures': figures, 'at_end': at_end}
