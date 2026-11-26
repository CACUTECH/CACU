"""Payroll to the books (Doc 03 FR-203; Doc 10 E21, R4).

An approved payroll run is posted by a separate, deliberate step (Owner or Admin with payroll.approve), as one journal
built from the run's own totals:

    Dr Salaries and wages (gross pay)          Cr Salaries payable (net pay owed to staff)
    Dr Employer pension contributions          Cr PAYE payable, Pension payable (employee and employer), NHF payable,
                                                  NHIS payable

It is dated the last day of the payroll month, or today if that is still to come. Then paying staff and remitting
each deduction are recorded against the run, from the till or a reviewed bank account, each clearing what it owes and
never more. Postings and payments are fixed once made; a mistake is reversed by a journal.

Off until the R4 release gate (accounting.payroll_switch): a professional must validate the payroll posting fixtures,
with statutory sign-off, before any business posts payroll.
"""
import json
from datetime import date, timedelta
from decimal import Decimal
from typing import Literal
from uuid import UUID, uuid5
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from cacu.accounting.posting import PostingCommand, PostingLine, post_command, raw

ZERO = Decimal('0')
OFF_MESSAGE = 'Posting payroll to the books is not available yet.'
ROLE_MESSAGE = 'Only the business owner or an Admin can post payroll to the books.'
ACCOUNTS = {'salaries_payable': 'Salaries payable', 'paye_payable': 'PAYE payable', 'pension_payable': 'Pension payable',
            'nhf_payable': 'NHF payable', 'nhis_payable': 'NHIS payable', 'employer_pension': 'Employer pension contributions',
            'payroll_salaries': 'Salaries and wages'}
# What each kind of payment clears, the account it clears, and how it reads.
SETTLEMENTS = {'net_pay': ('salaries_payable', 'Net pay to staff'), 'paye': ('paye_payable', 'PAYE to the tax authority'),
               'pension': ('pension_payable', 'Pension to the pension fund administrators'), 'nhf': ('nhf_payable', 'NHF to the Federal Mortgage Bank'),
               'nhis': ('nhis_payable', 'NHIS to the health insurer')}


class PostRun(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: UUID


class Settle(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: UUID
    kind: Literal['net_pay', 'paye', 'pension', 'nhf', 'nhis']
    amount: str = Field(pattern=r'^[0-9]{1,13}(\.[0-9]{1,2})?$')
    entry_date: date
    method: Literal['Cash', 'Transfer']
    bank_account_id: UUID | None = None
    reference: str | None = Field(default=None, max_length=120)

    @field_validator('amount')
    @classmethod
    def _positive(cls, value):
        if Decimal(value) <= 0:
            raise ValueError('Amount must be positive')
        return value



def _enabled(session) -> bool:
    return bool(raw(session, 'SELECT enabled FROM accounting.payroll_switch WHERE singleton').scalar())


def _allowed(session, actor):
    from cacu.accounting.workflows import role
    if not _enabled(session):
        raise HTTPException(409, OFF_MESSAGE)
    if role(session, actor) not in {'owner', 'admin'}:
        raise HTTPException(403, ROLE_MESSAGE)


def _purpose(session, name):
    rows = raw(session, 'SELECT account_id FROM accounting.account_map WHERE business_id=%s AND purpose=%s', (str(session.business_id), name)).all()
    return rows[0].account_id if len(rows) == 1 else None


def _salary_account(session):
    """Salaries and wages: the default chart's 6000 when the business has it, otherwise its own payroll account."""
    found = _purpose(session, 'payroll_salaries')
    if found:
        return found
    return raw(session, """SELECT a.id FROM public.accounts a JOIN accounting.account_map m ON m.business_id=a.business_id AND m.account_id=a.id
        JOIN accounting.account n ON n.id=m.library_id AND n.business_id=m.business_id
        WHERE a.business_id=%s AND a.code='6000' AND a.is_active AND n.account_type::text='OPERATING_EXPENSE' LIMIT 1""", (str(session.business_id),)).scalar()


def _ensure(session, actor, needed: set[str]):
    """Adds the payroll accounts this run needs to the chart, once (the same request key each time)."""
    from cacu.accounting.accounts import add_account
    tenant = str(session.business_id)
    for kind in sorted(needed):
        if kind == 'payroll_salaries' and _salary_account(session):
            continue
        if _purpose(session, kind) is None:
            add_account(session, actor, uuid5(UUID(int=0), f'cacu:{kind}:{tenant}'), kind, ACCOUNTS[kind])


def _run(session, run_id):
    run = raw(session, 'SELECT accounting.payroll_run(%s,%s)', (str(session.business_id), str(run_id))).scalar()
    if not run:
        raise HTTPException(404, 'Payroll run not found')
    return run


def _d(value) -> Decimal:
    """An amount from JSON (where numbers arrive as floats) as exact kobo."""
    return Decimal(str(value)).quantize(Decimal('0.01'))


def _owed(totals: dict) -> dict:
    return {'net_pay': _d(totals['net_total']), 'paye': _d(totals['paye_total']),
            'pension': _d(totals['pension_employee_total']) + _d(totals['pension_employer_total']),
            'nhf': _d(totals['nhf_total']), 'nhis': _d(totals['nhis_total'])}


def _money(value: Decimal) -> str:
    return format(value.quantize(Decimal('0.01')), 'f')


def _state(session, run: dict) -> dict:
    tenant = str(session.business_id)
    posting = raw(session, 'SELECT * FROM accounting.payroll_posting WHERE business_id=%s AND run_id=%s', (tenant, run['id'])).first()
    out = {'run': run, 'posted': None, 'outstanding': None, 'settlements': []}
    if posting is None:
        return out
    paid = raw(session, """SELECT id, kind, amount, entry_date, paid_from, reference, created_at FROM accounting.payroll_settlement
        WHERE business_id=%s AND run_id=%s ORDER BY entry_date, created_at""", (tenant, run['id'])).all()
    owed = _owed(posting.totals)
    for p in paid:
        owed[p.kind] -= p.amount
    names = dict(raw(session, 'SELECT id::text, name FROM public.accounts WHERE business_id=%s', (tenant,)).all())
    out['posted'] = {'entry_date': posting.entry_date.isoformat(), 'posted_at': posting.posted_at.isoformat(), 'transaction_id': posting.transaction_id}
    out['outstanding'] = {k: _money(v) for k, v in owed.items()}
    out['settlements'] = [{'id': str(p.id), 'kind': p.kind, 'label': SETTLEMENTS[p.kind][1], 'amount': _money(p.amount),
                           'entry_date': p.entry_date.isoformat(), 'paid_from': names.get(str(p.paid_from), 'Account'), 'reference': p.reference}
                          for p in paid]
    return out


def overview(session, actor) -> dict:
    """Approved payroll runs and where each stands in the books, with the accounts payroll can be paid from."""
    from cacu.accounting.workflows import bank_accounts
    enabled = _enabled(session)
    out = {'enabled': enabled, 'message': None if enabled else OFF_MESSAGE, 'runs': [], 'pay_from': {'cash': False, 'banks': []}}
    if not enabled:
        return out
    runs = raw(session, 'SELECT accounting.payroll_runs(%s)', (str(session.business_id),)).scalar() or []
    out['runs'] = [_state(session, r) for r in runs]
    out['pay_from'] = {'cash': _purpose(session, 'cash') is not None, 'banks': bank_accounts(session)}
    return out


def post_run(session, actor, run_id, request: PostRun) -> dict:
    """Posts an approved run as one journal (FR-203). Posting the same run again returns what was posted."""
    from cacu.accounting.workflows import business_today
    _allowed(session, actor)
    tenant = str(session.business_id)
    run = _run(session, run_id)
    if raw(session, 'SELECT 1 FROM accounting.payroll_posting WHERE business_id=%s AND run_id=%s', (tenant, str(run_id))).first():
        return _state(session, run)
    if run['status'] != 'approved':
        raise HTTPException(409, 'Approve this payroll run before posting it to the books.')
    period = date.fromisoformat(run['period'])
    month_end = (period.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    entry_date = min(month_end, business_today(session))
    if entry_date < period:
        raise HTTPException(409, 'This payroll month has not started yet.')
    cutover = raw(session, 'SELECT cutover_date FROM accounting.business_map WHERE business_id=%s', (tenant,)).scalar()
    if cutover is None or entry_date < cutover:
        raise HTTPException(409, 'This payroll is for a month before your books started in CACU. Record it in your opening position instead.')
    gross, employer = _d(run['gross_total']), _d(run['pension_employer_total'])
    owed = _owed(run)
    deductions = {'paye_payable': owed['paye'], 'pension_payable': owed['pension'], 'nhf_payable': owed['nhf'], 'nhis_payable': owed['nhis']}
    if gross + employer != owed['net_pay'] + sum(deductions.values(), ZERO) or owed['net_pay'] < 0:
        raise HTTPException(409, 'This payroll run does not add up: gross pay must equal net pay plus deductions. Check the payslips.')
    needed = {'salaries_payable', 'payroll_salaries'} | {k for k, v in deductions.items() if v > 0} | ({'employer_pension'} if employer > 0 else set())
    _ensure(session, actor, needed)
    lines = [PostingLine(account_id=_salary_account(session), amount=_money(gross), credited=False, description='Gross pay')]
    if employer > 0:
        lines.append(PostingLine(account_id=_purpose(session, 'employer_pension'), amount=_money(employer), credited=False,
                                 description='Employer pension contributions'))
    for kind, value in deductions.items():
        if value > 0:
            lines.append(PostingLine(account_id=_purpose(session, kind), amount=_money(value), credited=True, description=ACCOUNTS[kind]))
    label = period.strftime('%B %Y')
    result = post_command(session, actor, PostingCommand(
        request_key=request.request_key, kind='payroll', source_id=run_id, main_account_id=_purpose(session, 'salaries_payable'),
        entry_date=entry_date, narration=f'Payroll for {label}: {run["employee_count"]} staff', credited=True,
        main_amount=_money(owed['net_pay']), lines=lines), internal=True)
    totals = {k: _money(_d(run[k])) for k in ('gross_total', 'paye_total', 'pension_employee_total', 'pension_employer_total', 'nhf_total', 'nhis_total', 'net_total')}
    raw(session, """INSERT INTO accounting.payroll_posting(business_id, run_id, period, entry_date, totals, transaction_id, posted_by)
        VALUES (%s,%s,%s,%s,%s::jsonb,%s,%s) ON CONFLICT DO NOTHING""",
        (tenant, str(run_id), period, entry_date, json.dumps(totals), int(result['transaction_id']), str(actor)))
    return _state(session, run)


def settle(session, actor, run_id, request: Settle) -> dict:
    """Records paying staff their net pay, or remitting a deduction, against a posted run. Never more than is owed."""
    from cacu.accounting.workflows import business_today, collection_account
    _allowed(session, actor)
    tenant = str(session.business_id)
    run = _run(session, run_id)
    source = uuid5(request.request_key, 'payroll-settlement')
    if raw(session, 'SELECT 1 FROM accounting.payroll_settlement WHERE business_id=%s AND id=%s', (tenant, str(source))).first():
        return _state(session, run)  # a retried request
    posting = raw(session, 'SELECT * FROM accounting.payroll_posting WHERE business_id=%s AND run_id=%s FOR UPDATE', (tenant, str(run_id))).first()
    if posting is None:
        raise HTTPException(409, 'Post this payroll to the books before recording payments.')
    if request.entry_date < posting.entry_date:
        raise HTTPException(409, 'A payment cannot be dated before the payroll it pays.')
    if request.entry_date > business_today(session):
        raise HTTPException(409, 'A payment cannot be dated in the future.')
    amount = Decimal(request.amount)
    state = _state(session, run)
    left = Decimal(state['outstanding'][request.kind])
    if amount > left:
        raise HTTPException(409, f'Only ₦{left:,.2f} is still owed for this.')
    paid_from = collection_account(session, request.method, request.bank_account_id)
    owes, label = SETTLEMENTS[request.kind]
    result = post_command(session, actor, PostingCommand(
        request_key=request.request_key, kind='payroll_payment' if request.kind == 'net_pay' else 'payroll_remittance', source_id=source,
        main_account_id=paid_from, entry_date=request.entry_date, credited=True,
        narration=f'{label} for {date.fromisoformat(run["period"]).strftime("%B %Y")}' + (f' ({request.reference})' if request.reference else ''),
        lines=[PostingLine(account_id=_purpose(session, owes), amount=_money(amount), credited=False)]), internal=True)
    raw(session, """INSERT INTO accounting.payroll_settlement(business_id, id, run_id, kind, amount, entry_date, paid_from, reference, transaction_id, created_by)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (tenant, str(source), str(run_id), request.kind, amount, request.entry_date, str(paid_from), request.reference,
         int(result['transaction_id']), str(actor)))
    return _state(session, run)
