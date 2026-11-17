"""Month close and reopen (Doc 09 periods and month-end checklist; Doc 03 FR-135; Doc 11 R3 /periods endpoints).

Owner decisions of 17 November 2026: a closed month takes no posting by any route (the ledger refuses it,
accounting.ledger_month_open). Closing is refused while the trial balance does not balance at the month's end, or
while receivables, payables or stock differ from their control accounts. The other checklist steps are warnings
that the closer ticks or explains; the answers are kept with the close. Closing needs ledger.post and ledger.approve;
reopening is Owner only, with a reason. Months close in order from the month the books started, only once ended, and
only the latest closed month can be reopened.

The subledgers (open invoices, open bills, stock on hand) hold today's position, so their control checks run on
today's books: every later posting goes through a document that moves both sides, so books that agree today agreed
at the month's end too.
"""
import json
from datetime import date, timedelta
from uuid import uuid4
from fastapi import HTTPException
from pydantic import BaseModel, Field
from cacu.accounting.posting import raw
from cacu.accounting.workflows import business_today

CLOSED_MONTH_MESSAGE = 'This month is closed. Date it in an open month, or ask the owner to reopen the month.'

# Doc 09 checklist. Blocking steps refuse the close; the rest are warnings to tick or explain.
STEPS = {
    'trial_balance': ('Trial balance balances at the end of the month', True),
    'receivables': ('Customer balances on open invoices match the receivables account', True),
    'payables': ('Supplier balances on open bills match the payables account', True),
    'stock': ('Stock on hand at cost matches the inventory account', True),
    'transfers': ('No transfers waiting for confirmation more than 7 days', False),
    'gateway': ('Card and online payments clearing is settled', False),
    'bank_cash': ('Bank and cash balances agree with your statements and cash count', False),
    'stock_count': ('Stock counted or reviewed, and differences recorded', False),
    'accruals': ('Bills and costs for the month recorded, even if not yet paid', False),
    'review': ('Statements for the month reviewed by the Owner or an Admin', False),
}
MANUAL = ('bank_cash', 'stock_count', 'accruals', 'review')


class Acknowledgement(BaseModel):
    done: bool = False
    note: str = Field(default='', max_length=500)


class CloseMonth(BaseModel):
    acknowledgements: dict[str, Acknowledgement] = Field(default_factory=dict)


class ReopenMonth(BaseModel):
    reason: str = Field(min_length=5, max_length=500)


def month_start(day: date) -> date:
    return day.replace(day=1)


def month_end(month: date) -> date:
    return (month.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)


def next_month(month: date) -> date:
    return month_end(month) + timedelta(days=1)


def month_closed(session, day: date) -> bool:
    return bool(raw(session, 'SELECT accounting.month_closed(%s,%s)', (str(session.business_id), day)).scalar())


def refuse_closed_month(session, day: date):
    """For checks made before posting, so people get a plain answer rather than the ledger's refusal."""
    if month_closed(session, day):
        raise HTTPException(409, CLOSED_MONTH_MESSAGE)


def _first_month(session):
    cutover = raw(session, "SELECT cutover_date FROM accounting.business_map WHERE business_id=%s AND state='active'",
                  (str(session.business_id),)).scalar()
    if cutover is None:
        raise HTTPException(409, 'Start your books before closing a month.')
    return month_start(cutover)


def _rows(session):
    return {r.month: r for r in raw(session, 'SELECT * FROM accounting.period_close WHERE business_id=%s ORDER BY month',
                                    (str(session.business_id),)).all()}


def _tracks_stock(session):
    return bool(raw(session, "SELECT EXISTS(SELECT FROM public.catalog_items WHERE business_id=%s AND item_type='PRODUCT' AND track_stock AND is_active)",
                    (str(session.business_id),)).scalar())


def checklist(session, month: date):
    """Each step with whether it passes now. Blocking steps decide whether the month can close."""
    from cacu.accounting.reports import trial_balance
    from cacu.accounting.transfers import list_transfers
    end = month_end(month)
    at_end = trial_balance(session, end)
    today = trial_balance(session, business_today(session))
    differing = {e['check']: e['message'] for e in today['exceptions'] if e['check'] in {'receivables', 'payables', 'stock'}}
    steps = {'trial_balance': (at_end['difference'] == '0.00', None if at_end['difference'] == '0.00' else f"Debits and credits differ by {at_end['difference']}")}
    for check in ('receivables', 'payables', 'stock'):
        steps[check] = (check not in differing, differing.get(check))
    waiting = [t for t in list_transfers(session, 'pending') if t['age_days'] > 7]
    steps['transfers'] = (not waiting, f'{len(waiting)} waiting more than 7 days' if waiting else None)
    clearing = raw(session, "SELECT account_id::text FROM accounting.account_map WHERE business_id=%s AND purpose='gateway_clearing'",
                   (str(session.business_id),)).scalar()
    line = next((l for l in at_end['lines'] if l['account_id'] == clearing), None) if clearing else None
    steps['gateway'] = (line is None, f"{line['debit'] if line['debit'] != '0.00' else line['credit']} not yet settled" if line else None)
    for manual in MANUAL:
        steps[manual] = (manual == 'stock_count' and not _tracks_stock(session), None)
    return [{'key': key, 'label': STEPS[key][0], 'blocking': STEPS[key][1], 'passed': passed, 'detail': detail,
             'needs_answer': not passed and not STEPS[key][1]} for key, (passed, detail) in steps.items()]


def overview(session):
    """Every month from the start of the books to the last ended one, with which can close or reopen now."""
    first, rows = _first_month(session), _rows(session)
    current = month_start(business_today(session))
    months, month = [], first
    while month < current:
        row = rows.get(month)
        months.append({'month': month.isoformat(), 'status': row.status if row else 'open',
                       'closed_at': row.closed_at.isoformat() if row and row.status == 'closed' else None})
        month = next_month(month)
    closed = [m for m in months if m['status'] == 'closed']
    latest_closed = closed[-1]['month'] if closed else None
    next_to_close = next((m['month'] for m in months if m['status'] != 'closed'), None)
    history = raw(session, """SELECT event, details, created_at FROM accounting.audit_event
        WHERE business_id=%s AND event IN ('period_closed','period_reopened') ORDER BY created_at DESC LIMIT 50""",
                  (str(session.business_id),)).all()
    return {'months': list(reversed(months)), 'next_to_close': next_to_close, 'latest_closed': latest_closed,
            'checklist': checklist(session, date.fromisoformat(next_to_close)) if next_to_close else [],
            'history': [{'event': h.event, 'month': h.details.get('month'), 'reason': h.details.get('reason'),
                         'at': h.created_at.isoformat()} for h in history]}


def _month(value: str) -> date:
    try:
        month = date.fromisoformat(value if len(value) > 7 else value + '-01')
    except ValueError:
        raise HTTPException(422, 'Give the month as YYYY-MM.') from None
    if month.day != 1:
        raise HTTPException(422, 'Give the month as YYYY-MM.')
    return month


def close_month(session, actor, value: str, data: CloseMonth):
    month = _month(value)
    first, rows = _first_month(session), _rows(session)
    if month < first:
        raise HTTPException(409, 'That month is before your books started.')
    if month >= month_start(business_today(session)):
        raise HTTPException(409, 'A month can be closed only after it has ended.')
    if (row := rows.get(month)) is not None and row.status == 'closed':
        raise HTTPException(409, 'This month is already closed.')
    earlier = first
    while earlier < month:
        if (r := rows.get(earlier)) is None or r.status != 'closed':
            raise HTTPException(409, f'Close {earlier:%B %Y} first. Months close in order.')
        earlier = next_month(earlier)
    steps = checklist(session, month)
    failed = [s['label'] for s in steps if s['blocking'] and not s['passed']]
    if failed:
        raise HTTPException(409, 'The month cannot close yet: ' + '; '.join(failed) + '.')
    answers = {}
    for step in steps:
        if not step['needs_answer']:
            continue
        answer = data.acknowledgements.get(step['key'])
        note = (answer.note if answer else '').strip()
        if not answer or (not answer.done and len(note) < 5):
            raise HTTPException(422, f"Tick or explain: {step['label']}.")
        answers[step['key']] = {'done': answer.done, 'note': note}
    record = {'steps': steps, 'answers': answers}
    raw(session, """INSERT INTO accounting.period_close(business_id,month,status,closed_by,checklist) VALUES(%s,%s,'closed',%s,%s::jsonb)
        ON CONFLICT (business_id,month) DO UPDATE SET status='closed',closed_by=EXCLUDED.closed_by,closed_at=now(),checklist=EXCLUDED.checklist,
         reopened_by=NULL,reopened_at=NULL,reopen_reason=NULL""", (str(session.business_id), month, str(actor), json.dumps(record)))
    raw(session, 'INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,%s,%s::jsonb)',
        (str(session.business_id), str(actor), str(uuid4()), 'period_closed', json.dumps({'month': month.isoformat(), 'answers': answers})))
    return overview(session)


def reopen_month(session, actor, value: str, data: ReopenMonth):
    month = _month(value)
    role = raw(session, 'SELECT accounting.lock_membership(%s,%s)', (str(session.business_id), str(actor))).scalar()
    if role != 'owner':
        raise HTTPException(403, 'Only the business owner can reopen a month.')
    rows = _rows(session)
    if (row := rows.get(month)) is None or row.status != 'closed':
        raise HTTPException(409, 'This month is not closed.')
    if any(m > month and r.status == 'closed' for m, r in rows.items()):
        raise HTTPException(409, 'Reopen the later months first. Only the latest closed month can be reopened.')
    raw(session, """UPDATE accounting.period_close SET status='reopened',reopened_by=%s,reopened_at=now(),reopen_reason=%s
        WHERE business_id=%s AND month=%s""", (str(actor), data.reason.strip(), str(session.business_id), month))
    raw(session, 'INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,%s,%s::jsonb)',
        (str(session.business_id), str(actor), str(uuid4()), 'period_reopened', json.dumps({'month': month.isoformat(), 'reason': data.reason.strip()})))
    return overview(session)
