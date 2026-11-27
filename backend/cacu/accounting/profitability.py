"""Management profitability by product, service, outlet and job (Doc 09 statement set; Doc 12 Reports › Profitability).

For a period:
* revenue is what till sales and invoices dated in it charged for each catalogue item, less refunds and credit notes
  made in it, and net of VAT where VAT was charged (the VAT goes to the tax office, not into profit);
* cost is what the stock that left for those sales, invoices and jobs cost when it left, less the cost of goods
  that came back with refunds and credit notes. Services have no stock cost;
* by outlet: till sales by the outlet their stock left from; invoices and services sold without stock movement show as
  "Invoices and services" where no outlet was recorded;
* by job (Chairman, with module.job_costing): each job completed in the period, revenue less materials less labour at
  each staff member's cost rate, as on the job itself.
These are management figures from the posted books, labelled as such; they are not statutory statements.
"""
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from cacu.accounting.posting import raw

ZERO = Decimal('0')
CENT = Decimal('0.01')


def _money(value):
    return format(Decimal(value).quantize(CENT), '.2f')


def _span(start: date, end: date):
    """For ledger dates, which are business-local dates stored without a zone."""
    return datetime.combine(start, time.min), datetime.combine(end + timedelta(days=1), time.min)


def _moments(session, start: date, end: date):
    """For moments recorded with a zone (when stock left, when a job was completed): midnight in the business's own
    timezone, so a sale just after midnight in Lagos counts its cost on the same day as its revenue."""
    from zoneinfo import ZoneInfo
    zone = ZoneInfo(session.business_timezone)
    return datetime.combine(start, time.min, zone), datetime.combine(end + timedelta(days=1), time.min, zone)


def _vat_factors(session, source_type):
    """For documents that charged VAT with prices including it: the share of each line value that is not VAT."""
    rows = raw(session, """SELECT source_id::text, base, vat FROM accounting.document_vat
        WHERE business_id=%s AND source_type=%s AND original_id IS NULL AND inclusive AND vat>0 AND base>0""",
               (str(session.business_id), source_type)).all()
    return {r.source_id: (Decimal(r.base) - Decimal(r.vat)) / Decimal(r.base) for r in rows}


def report(session, start: date, end: date):
    from cacu.accounting.reports import validate_dates
    from cacu.accounting.jobs import costing_allowed, detail as job_detail
    validate_dates(start, end)
    tenant = str(session.business_id)
    lo, hi = _span(start, end)
    since, until = _moments(session, start, end)
    items = {r.id: {'item_id': r.id, 'name': r.name, 'kind': 'service' if r.item_type == 'SERVICE' else 'product', 'quantity': 0,
                    'revenue': ZERO, 'cost': ZERO}
             for r in raw(session, 'SELECT id::text, name, item_type FROM public.catalog_items WHERE business_id=%s', (tenant,)).all()}
    outlets = defaultdict(lambda: {'revenue': ZERO, 'cost': ZERO})
    names = {r.id: r.name for r in raw(session, 'SELECT id::text, name FROM public.business_locations WHERE business_id=%s', (tenant,)).all()} \
        if raw(session, "SELECT to_regclass('public.business_locations') IS NOT NULL").scalar() else {}
    sale_outlet = {r.source_id: r.location for r in raw(session, """SELECT source_id::text, min(location_id::text) AS location FROM accounting.stock_event
        WHERE business_id=%s AND quantity<0 GROUP BY 1""", (tenant,)).all()}
    pos_vat, invoice_vat = _vat_factors(session, 'pos'), _vat_factors(session, 'invoice')

    def add(item_id, quantity, value, outlet):
        line = items.get(item_id)
        if line is None:
            return
        line['quantity'] += quantity
        line['revenue'] += value
        outlets[outlet]['revenue'] += value

    # Till sales and invoices dated in the period.
    for r in raw(session, """SELECT d.source_type, d.source_id::text AS doc, coalesce(ti.catalog_item_id, ii.catalog_item_id)::text AS item,
        coalesce(ti.quantity, ii.quantity) AS quantity, coalesce(ti.line_total, ii.line_total) AS value
        FROM accounting.document_map d JOIN accounting."transaction" t ON t.id=d.transaction_id AND t.business_id=d.business_id
        LEFT JOIN public.transaction_items ti ON d.source_type='pos' AND ti.business_id=d.business_id AND ti.transaction_id=d.source_id
        LEFT JOIN public.invoice_items ii ON d.source_type='invoice' AND ii.business_id=d.business_id AND ii.invoice_id=d.source_id
        WHERE d.business_id=%s AND d.source_type IN ('pos','invoice') AND t.transaction_date>=%s AND t.transaction_date<%s
          AND coalesce(ti.catalog_item_id, ii.catalog_item_id) IS NOT NULL""", (tenant, lo, hi)).all():
        factor = (pos_vat if r.source_type == 'pos' else invoice_vat).get(r.doc, Decimal('1'))
        outlet = sale_outlet.get(r.doc) if r.source_type == 'pos' else None
        add(r.item, int(r.quantity), (Decimal(r.value) * factor).quantize(CENT), outlet)
    # Refunds and credit notes posted in the period take their share back.
    for r in raw(session, """SELECT s.sale_id::text AS doc, l.item_id::text AS item, l.quantity, l.amount FROM accounting.sale_refund_line l
        JOIN accounting.sale_refund s ON s.business_id=l.business_id AND s.id=l.refund_id
        WHERE l.business_id=%s AND s.status='posted' AND s.decided_on BETWEEN %s AND %s""", (tenant, start, end)).all():
        add(r.item, -int(r.quantity), -(Decimal(r.amount) * pos_vat.get(r.doc, Decimal('1'))).quantize(CENT), sale_outlet.get(r.doc))
    for r in raw(session, """SELECT c.invoice_id::text AS doc, l.item_id::text AS item, l.quantity, l.amount FROM accounting.invoice_credit_line l
        JOIN accounting.invoice_credit c ON c.business_id=l.business_id AND c.id=l.credit_id
        WHERE l.business_id=%s AND c.status='posted' AND c.decided_on BETWEEN %s AND %s""", (tenant, start, end)).all():
        add(r.item, -int(r.quantity), -(Decimal(r.amount) * invoice_vat.get(r.doc, Decimal('1'))).quantize(CENT), None)

    # Cost of what left for sales, invoices and jobs in the period, less what came back with refunds and credit notes.
    for r in raw(session, """SELECT e.item_id::text AS item, e.quantity, e.unit_cost, e.location_id::text AS location FROM accounting.stock_event e
        WHERE e.business_id=%s AND e.created_at>=%s AND e.created_at<%s AND (
          EXISTS (SELECT FROM accounting.document_map d WHERE d.business_id=e.business_id AND d.source_id=e.source_id AND d.source_type IN ('pos','invoice'))
          OR EXISTS (SELECT FROM public.jobs j WHERE j.business_id=e.business_id AND j.id=e.source_id)
          OR EXISTS (SELECT FROM accounting.sale_refund s WHERE s.business_id=e.business_id AND s.id=e.source_id)
          OR EXISTS (SELECT FROM accounting.invoice_credit c WHERE c.business_id=e.business_id AND c.id=e.source_id))""",
                 (tenant, since, until)).all() if raw(session, "SELECT to_regclass('public.jobs') IS NOT NULL").scalar() else []:
        cost = (-int(r.quantity) * Decimal(r.unit_cost)).quantize(CENT)
        if r.item in items:
            items[r.item]['cost'] += cost
        outlets[r.location]['cost'] += cost

    def row(name, revenue, cost, **extra):
        profit = revenue - cost
        return {'name': name, **extra, 'revenue': _money(revenue), 'cost': _money(cost), 'profit': _money(profit),
                'margin': format((profit / revenue * 100).quantize(Decimal('1')), 'f') if revenue > 0 else None}
    lines = sorted((l for l in items.values() if l['quantity'] or l['revenue'] or l['cost']), key=lambda l: -(l['revenue'] - l['cost']))
    by_item = [row(l['name'], l['revenue'], l['cost'], item_id=l['item_id'], kind=l['kind'], quantity=l['quantity']) for l in lines]
    by_outlet = [row(names.get(k, 'Main outlet') if k else 'Invoices and services', v['revenue'], v['cost']) for k, v in
                 sorted(outlets.items(), key=lambda kv: (kv[0] is None, names.get(kv[0] or '', '')))]
    revenue, cost = sum((l['revenue'] for l in lines), ZERO), sum((l['cost'] for l in lines), ZERO)
    jobs = None
    if costing_allowed(session) and raw(session, "SELECT to_regclass('public.jobs') IS NOT NULL").scalar():
        jobs = []
        for j in raw(session, """SELECT j.id FROM public.jobs j WHERE j.business_id=%s AND j.status='completed'
            AND j.completed_at>=%s AND j.completed_at<%s ORDER BY j.number""", (tenant, since, until)).all():
            d = job_detail(session, None, j.id)
            if d.get('profit'):
                jobs.append({'job_id': d['id'], 'number': d['number'], 'revenue': d['revenue'], 'materials': d['materials_cost'],
                             'labour': d['profit']['labour_cost'], 'profit': d['profit']['profit'], 'unrated': d['profit']['unrated_entries']})
    return {'start_date': start.isoformat(), 'end_date': end.isoformat(), 'label': 'Management figures from your books, not reviewed',
            'items': by_item, 'outlets': by_outlet, 'jobs': jobs,
            'totals': row('All sales', revenue, cost)}
