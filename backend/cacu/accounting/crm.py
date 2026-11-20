"""Customer tags, segments and lifetime value (Doc 10 CRM; Doc 18 R3 "E06 segments").

A segment is a saved set of rules, all of which a customer must meet:
  spent_at_least {amount, days}  — bought at least this much in the last N days
  spent_less_than {amount, days} — bought less than this in the last N days
  no_purchase_for {days}         — has not bought for N days (customers who never bought are included)
  bought_within {days}           — bought in the last N days
  owes_at_least {amount}         — owes at least this much now (what is outstanding, less advances held)
  tags_any [tag, ...]            — carries at least one of these tags
Buying means an issued invoice (a credit sale at the till, a booking or a job is invoiced too), less credit notes.
Walk-in cash sales name no customer, so they are not counted for anyone.

Lifetime value (Chairman, Doc 10 "Empire"): everything invoiced to the customer since the books started, less credit
notes. Businesses without a subscription (before billing) see it too.
"""
import csv
import io
from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID
from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator
from cacu.accounting.posting import raw
from cacu.accounting.workflows import business_today

ZERO = Decimal('0')
AMOUNT = r'^[0-9]{1,13}(\.[0-9]{1,2})?$'


class Spend(BaseModel):
    amount: str = Field(pattern=AMOUNT)
    days: int = Field(ge=1, le=3660)


class Days(BaseModel):
    days: int = Field(ge=1, le=3660)


class Rules(BaseModel):
    spent_at_least: Spend | None = None
    spent_less_than: Spend | None = None
    no_purchase_for: Days | None = None
    bought_within: Days | None = None
    owes_at_least: str | None = Field(default=None, pattern=AMOUNT)
    tags_any: list[str] = Field(default_factory=list, max_length=20)

    @model_validator(mode='after')
    def something(self):
        if not any([self.spent_at_least, self.spent_less_than, self.no_purchase_for, self.bought_within, self.owes_at_least, self.tags_any]):
            raise ValueError('A segment needs at least one rule')
        self.tags_any = sorted({_tag(t) for t in self.tags_any})
        return self


class SegmentSave(BaseModel):
    id: UUID
    name: str = Field(min_length=1, max_length=80)
    rules: Rules


class Tags(BaseModel):
    tags: list[str] = Field(max_length=20)


def _tag(value: str) -> str:
    tag = ' '.join((value or '').lower().split())
    if not 1 <= len(tag) <= 30:
        raise ValueError('A tag is 1 to 30 characters')
    return tag


def lifetime_value_included(session) -> bool:
    # No subscription row (before billing): everything is included.
    return bool(raw(session, 'SELECT accounting.lifetime_value_included(%s)', (str(session.business_id),)).scalar())


def _facts(session):
    """Every customer with what they bought (by day), when they last bought, what they owe and their tags."""
    from cacu.accounting.receivables import ageing
    tenant, today = str(session.business_id), business_today(session)
    customers = {r.id: {'id': r.id, 'name': r.name, 'phone': r.phone, 'purchases': [], 'last': None, 'tags': [], 'owes': ZERO}
                 for r in raw(session, "SELECT id::text, name, to_jsonb(c)->>'phone_number' AS phone FROM public.customers c WHERE business_id=%s ORDER BY name LIMIT 5000",
                              (tenant,)).all()}
    from cacu.accounting.reports import opening_transactions
    opening = opening_transactions(session)  # what customers owed when the books started is not a purchase
    for r in raw(session, """SELECT i.customer_id::text AS id, i.issue_date, d.transaction_id, i.total - coalesce((to_jsonb(i)->>'credited_total')::numeric, 0) AS value
        FROM public.invoices i JOIN accounting.document_map d ON d.business_id=i.business_id AND d.source_id=i.id AND d.source_type='invoice'
        WHERE i.business_id=%s AND i.customer_id IS NOT NULL AND i.status <> 'void'""", (tenant,)).all():
        c = customers.get(r.id)
        if c is None or r.transaction_id in opening:
            continue
        c['purchases'].append((r.issue_date, Decimal(r.value)))
        c['last'] = max(c['last'], r.issue_date) if c['last'] else r.issue_date
    for r in raw(session, 'SELECT customer_id::text, tag FROM accounting.customer_tag WHERE business_id=%s ORDER BY tag', (tenant,)).all():
        if r.customer_id in customers:
            customers[r.customer_id]['tags'].append(r.tag)
    for row in ageing(session, 'receivables', today)['rows']:
        if row['party_id'] in customers:
            customers[row['party_id']]['owes'] = Decimal(row['net'])
    return list(customers.values()), today


def _spent(c, today, days):
    since = today - timedelta(days=days - 1)
    return sum((v for d, v in c['purchases'] if d >= since), ZERO)


def matches(c, rules: Rules, today) -> bool:
    if rules.spent_at_least and _spent(c, today, rules.spent_at_least.days) < Decimal(rules.spent_at_least.amount):
        return False
    if rules.spent_less_than and _spent(c, today, rules.spent_less_than.days) >= Decimal(rules.spent_less_than.amount):
        return False
    if rules.no_purchase_for and c['last'] and (today - c['last']).days < rules.no_purchase_for.days:
        return False
    if rules.bought_within and (not c['last'] or (today - c['last']).days >= rules.bought_within.days):
        return False
    if rules.owes_at_least and c['owes'] < Decimal(rules.owes_at_least):
        return False
    if rules.tags_any and not set(rules.tags_any) & set(c['tags']):
        return False
    return True


def _row(c, today, with_value):
    out = {'id': c['id'], 'name': c['name'], 'phone': c['phone'], 'tags': c['tags'], 'owes': format(c['owes'], '.2f'),
           'last_purchase': c['last'].isoformat() if c['last'] else None, 'days_since': (today - c['last']).days if c['last'] else None,
           'spent_90_days': format(_spent(c, today, 90), '.2f')}
    if with_value:
        out['lifetime_value'] = format(sum((v for _, v in c['purchases']), ZERO), '.2f')
    return out


def _saved(session):
    return raw(session, 'SELECT id::text, name, rules FROM accounting.customer_segment WHERE business_id=%s ORDER BY lower(name)',
               (str(session.business_id),)).all()


def overview(session):
    """The saved segments with how many customers each holds now, and every tag in use."""
    customers, today = _facts(session)
    segments = []
    for s in _saved(session):
        rules = Rules(**s.rules)
        segments.append({'id': s.id, 'name': s.name, 'rules': rules.model_dump(exclude_none=True), 'customers': sum(1 for c in customers if matches(c, rules, today))})
    tags = sorted({t for c in customers for t in c['tags']})
    return {'segments': segments, 'tags': tags, 'customers': len(customers), 'lifetime_value': lifetime_value_included(session)}


def members(session, rules: Rules):
    """The customers a rule set picks out now, with the facts it looked at; highest value first where shown."""
    customers, today = _facts(session)
    with_value = lifetime_value_included(session)
    rows = [_row(c, today, with_value) for c in customers if matches(c, rules, today)]
    rows.sort(key=lambda r: (-Decimal(r.get('lifetime_value', r['spent_90_days'])), r['name']))
    return {'customers': rows, 'count': len(rows), 'lifetime_value': with_value}


def segment(session, segment_id):
    row = raw(session, 'SELECT id::text, name, rules FROM accounting.customer_segment WHERE business_id=%s AND id=%s',
              (str(session.business_id), str(segment_id))).first()
    if row is None:
        raise HTTPException(404, 'That segment is not in this business.')
    return {'id': row.id, 'name': row.name, 'rules': Rules(**row.rules).model_dump(exclude_none=True), **members(session, Rules(**row.rules))}


def export(session, segment_id) -> str:
    """The segment's customers as CSV, for the owner's own use."""
    found = segment(session, segment_id)
    out = io.StringIO()
    writer = csv.writer(out)
    header = ['Name', 'Phone', 'Tags', 'Owes', 'Last purchase', 'Spent in 90 days'] + (['Lifetime value'] if found['lifetime_value'] else [])
    writer.writerow(header)
    for c in found['customers']:
        writer.writerow([c['name'], c['phone'] or '', '; '.join(c['tags']), c['owes'], c['last_purchase'] or '', c['spent_90_days']]
                        + ([c['lifetime_value']] if found['lifetime_value'] else []))
    return out.getvalue()


def save_segment(session, actor, data: SegmentSave):
    tenant = str(session.business_id)
    clash = raw(session, 'SELECT id FROM accounting.customer_segment WHERE business_id=%s AND lower(name)=lower(%s) AND id<>%s',
                (tenant, data.name.strip(), str(data.id))).first()
    if clash:
        raise HTTPException(409, 'A segment with that name already exists.')
    import json
    raw(session, """INSERT INTO accounting.customer_segment(business_id,id,name,rules,created_by) VALUES(%s,%s,%s,%s::jsonb,%s)
        ON CONFLICT (business_id,id) DO UPDATE SET name=EXCLUDED.name, rules=EXCLUDED.rules, updated_at=now()""",
        (tenant, str(data.id), data.name.strip(), json.dumps(data.rules.model_dump(mode='json', exclude_none=True)), str(actor)))
    return segment(session, data.id)


def delete_segment(session, segment_id):
    gone = raw(session, 'DELETE FROM accounting.customer_segment WHERE business_id=%s AND id=%s RETURNING id', (str(session.business_id), str(segment_id))).first()
    if gone is None:
        raise HTTPException(404, 'That segment is not in this business.')
    return overview(session)


def set_tags(session, actor, customer_id, data: Tags):
    tenant = str(session.business_id)
    if not raw(session, 'SELECT 1 FROM public.customers WHERE business_id=%s AND id=%s', (tenant, str(customer_id))).first():
        raise HTTPException(404, 'That customer is not in this business.')
    try:
        tags = sorted({_tag(t) for t in data.tags})
    except ValueError as bad:
        raise HTTPException(422, str(bad)) from None
    raw(session, 'DELETE FROM accounting.customer_tag WHERE business_id=%s AND customer_id=%s', (tenant, str(customer_id)))
    for tag in tags:
        raw(session, 'INSERT INTO accounting.customer_tag(business_id,customer_id,tag,created_by) VALUES(%s,%s,%s,%s)', (tenant, str(customer_id), tag, str(actor)))
    return {'customer_id': str(customer_id), 'tags': tags}
