"""Company income tax estimate (R4; Nigeria Tax Act 2025, effective 1 January 2026).

A yearly estimate from the books, every step shown, for the owner and their tax adviser. Nothing posts to the ledger
and CACU files nothing. Off until a tax professional reviews it (accounting.income_tax_switch); on for CACU's preview
business. Tax year Y is the twelve months ending on the last day of the business's year-end month in Y (31 December
unless it says otherwise, accounting.tax_profile).

    Profit before tax (from the books)
  + depreciation in the books (replaced by capital allowances)
  - book gain on disposals / + book loss (replaced by balancing charges and allowances)
  + expenses the law does not allow   - income that is not taxable       (entered by the owner)
  = adjusted profit
  - losses brought forward (losses are carried forward indefinitely)
  = assessable profit                                   -> development levy 4% (if not a small company)
  + balancing charges  - capital allowances  - balancing allowances
  = total profits                                       -> companies income tax 30% (if not a small company)
  - withholding tax customers deducted in the year, with a credit note (certificate) -> income tax to pay
    (credits beyond the tax are carried forward; deductions still awaiting a certificate are shown, not used)

Owner decisions of 26 November 2026: a small company has turnover up to N50 million (the Act's text; the June 2026
transition guidelines say N100 million) and fixed assets up to N250 million, and is not a professional services firm;
it pays neither. The figures live in one reviewed row, accounting.income_tax_rule. The fixed assets test uses the
carrying amount in the books at the year's end; whether cost is meant is for the reviewer.

In the books (owner decision of 27 November 2026): once the year has ended and its estimate is final, the Owner posts
it, dated the year's last day: Dr Income tax expense, Cr Income tax payable (what is left to pay) and Cr WHT credits
(withholding tax used). Payments to the tax office are recorded against it from the till or a bank, never more than is
owed. The Owner can reverse the posting while nothing is paid on it, and any payment, with a reason, by a journal dated
that day; the original is kept. Posted figures are fixed: a later change to the estimate needs the posting reversed and
posted again.
"""
from datetime import date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal
from uuid import UUID, uuid5
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from cacu.accounting.posting import raw

ZERO = Decimal('0')
CENT = Decimal('0.01')
AMOUNT = r'^[0-9]{1,13}(\.[0-9]{1,2})?$'
OFF_MESSAGE = 'The income tax estimate is not available yet.'
ROLE_MESSAGE = 'Only the business owner or an Admin can change the tax estimate.'
PROFIT_TYPES = ('OPERATING_REVENUE', 'NON_OPERATING_REVENUE', 'OPERATING_EXPENSE', 'DIRECT_EXPENSE', 'OVERHEAD_EXPENSE', 'OTHER_EXPENSE')


class TaxYear(BaseModel):
    model_config = ConfigDict(extra='forbid')
    losses_brought_forward: str = Field(default='0.00', pattern=AMOUNT)
    professional_services: bool = False


class TaxProfile(BaseModel):
    model_config = ConfigDict(extra='forbid')
    year_end_month: int = Field(ge=1, le=12)


class PostTax(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: UUID


class PayTax(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: UUID
    amount: str = Field(pattern=AMOUNT)
    entry_date: date
    method: Literal['Cash', 'Transfer']
    bank_account_id: UUID | None = None
    reference: str | None = Field(default=None, max_length=120)


class Reverse(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: UUID
    reason: str = Field(min_length=5, max_length=500)


class Adjustment(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: UUID
    direction: Literal['add', 'deduct']
    label: str = Field(min_length=2, max_length=120)
    amount: str = Field(pattern=AMOUNT)


def enabled(session) -> bool:
    return bool(raw(session, 'SELECT (SELECT enabled FROM accounting.income_tax_switch WHERE singleton) OR accounting.is_preview(%s)',
                    (str(session.business_id),)).scalar())


def _require(session):
    if not enabled(session):
        raise HTTPException(409, OFF_MESSAGE)


def _manager(session, actor):
    from cacu.accounting.workflows import role
    if role(session, actor) not in {'owner', 'admin'}:
        raise HTTPException(403, ROLE_MESSAGE)


def _year(year: int):
    if not 2026 <= year <= 2100:
        raise HTTPException(422, 'The estimate starts with 2026, when the Nigeria Tax Act 2025 took effect.')


def _money(value: Decimal) -> str:
    return format(value.quantize(CENT, ROUND_HALF_UP), 'f')


def _sum(session, start: date, end: date, where: str, args=()) -> Decimal:
    """Debits less credits on the accounts matched, posted from start to end."""
    return Decimal(raw(session, f"""SELECT coalesce(sum(CASE WHEN l.entry_type::text='DEBIT' THEN l.amount ELSE -l.amount END),0)
        FROM accounting.ledger l JOIN accounting.account a ON a.id=l.post_account_id AND a.business_id=l.business_id
        JOIN accounting.account_map m ON m.library_id=a.id AND m.business_id=l.business_id
        WHERE l.business_id=%s AND l.transaction_date>=%s AND l.transaction_date<%s AND ({where})""",
        (str(session.business_id), datetime.combine(start, time.min), datetime.combine(end + timedelta(days=1), time.min), *args)).scalar())


def estimate(session, year: int) -> dict:
    from cacu.accounting.allowances import figures as allowance_figures
    _require(session)
    _year(year)
    from cacu.accounting.tax_years import period, year_end_month
    tenant = str(session.business_id)
    end_month = year_end_month(session)
    start, end = period(year, end_month)
    rule = raw(session, 'SELECT * FROM accounting.income_tax_rule WHERE singleton').first()
    told = raw(session, 'SELECT * FROM accounting.tax_year WHERE business_id=%s AND year=%s', (tenant, year)).first()
    adjustments = raw(session, 'SELECT * FROM accounting.tax_adjustment WHERE business_id=%s AND year=%s ORDER BY created_at', (tenant, year)).all()

    # Profit before tax: the income tax expense posted for the year (7900) is left out, or posting the tax would
    # shrink the profit it was worked out from.
    profit = -_sum(session, start, end, "a.account_type::text = ANY(%s) AND m.purpose IS DISTINCT FROM 'income_tax_expense'", (list(PROFIT_TYPES),))
    turnover = -_sum(session, start, end, "a.account_type::text = 'OPERATING_REVENUE'")
    depreciation = _sum(session, start, end, "m.purpose = 'depreciation'")
    disposal_gain = -_sum(session, start, end, "m.purpose = 'disposal_gains'")
    fixed_assets = _sum(session, date(1900, 1, 1), end, "a.account_type::text IN ('NON_CURRENT_ASSET', 'CONTRA_ASSET')")
    added = sum((a.amount for a in adjustments if a.direction == 'add'), ZERO)
    deducted = sum((a.amount for a in adjustments if a.direction == 'deduct'), ZERO)
    allowances = allowance_figures(session, year)['totals']
    capital_allowance, charge, balancing_allowance = (Decimal(allowances[k]) for k in ('allowance', 'balancing_charge', 'balancing_allowance'))

    adjusted = profit + depreciation - disposal_gain + added - deducted
    brought = told.losses_brought_forward if told else ZERO
    if adjusted < 0:
        assessable, losses_carried = ZERO, brought - adjusted
    else:
        assessable, losses_carried = max(adjusted - brought, ZERO), max(brought - adjusted, ZERO)
    before_allowances = assessable + charge
    claimed = capital_allowance + balancing_allowance
    total_profits = max(before_allowances - claimed, ZERO)
    allowances_carried = max(claimed - before_allowances, ZERO)

    professional = bool(told.professional_services) if told else False
    small = turnover <= rule.small_turnover and fixed_assets <= rule.small_fixed_assets and not professional
    reasons = []
    if turnover > rule.small_turnover:
        reasons.append(f'turnover is above ₦{rule.small_turnover:,.0f}')
    if fixed_assets > rule.small_fixed_assets:
        reasons.append(f'fixed assets are above ₦{rule.small_fixed_assets:,.0f}')
    if professional:
        reasons.append('the business provides professional services')
    cit = ZERO if small else (total_profits * rule.cit_rate).quantize(CENT, ROUND_HALF_UP)
    levy = ZERO if small else (assessable * rule.levy_rate).quantize(CENT, ROUND_HALF_UP)
    # Withholding tax customers deducted in the year (VAT part 2c): a credit against income tax once the credit note
    # (certificate) is in hand. More than the tax is carried forward.
    wht = raw(session, """SELECT coalesce(sum(amount) FILTER (WHERE certificate IS NOT NULL), 0) AS credited,
        coalesce(sum(amount) FILTER (WHERE certificate IS NULL), 0) AS awaiting, count(*) FILTER (WHERE certificate IS NULL) AS missing
        FROM accounting.wht_deduction WHERE business_id=%s AND entry_date BETWEEN %s AND %s""", (tenant, start, end)).first()
    wht_used = min(Decimal(wht.credited), cit)
    cit_to_pay = cit - wht_used

    steps = [('Profit before tax, from the books', profit), ('Add: depreciation in the books', depreciation),
             ('Less: book gain on disposals' if disposal_gain >= 0 else 'Add: book loss on disposals', -disposal_gain),
             ('Add: expenses the law does not allow', added), ('Less: income that is not taxable', -deducted),
             ('Adjusted profit', adjusted), ('Less: losses brought forward used', -(brought - losses_carried) if adjusted >= 0 else ZERO),
             ('Assessable profit', assessable), ('Add: balancing charges', charge), ('Less: capital allowances', -capital_allowance),
             ('Less: balancing allowances', -balancing_allowance), ('Total profits', total_profits)]
    return {'year': year, 'small_company': small, 'not_small_because': reasons,
            'turnover': _money(turnover), 'fixed_assets': _money(fixed_assets),
            'steps': [{'label': label, 'amount': _money(value)} for label, value in steps if label in {'Adjusted profit', 'Assessable profit', 'Total profits', 'Profit before tax, from the books'} or value],
            'period': {'start': start.isoformat(), 'end': end.isoformat(), 'year_end_month': end_month},
            'companies_income_tax': _money(cit), 'development_levy': _money(levy), 'total_due': _money(cit_to_pay + levy),
            'wht': {'credited': _money(Decimal(wht.credited)), 'used': _money(wht_used), 'carried_forward': _money(Decimal(wht.credited) - wht_used),
                    'awaiting_certificate': _money(Decimal(wht.awaiting)), 'awaiting_count': int(wht.missing)},
            'income_tax_to_pay': _money(cit_to_pay),
            'cit_rate_percent': _money(rule.cit_rate * 100), 'levy_rate_percent': _money(rule.levy_rate * 100),
            'small_turnover': _money(rule.small_turnover), 'small_fixed_assets': _money(rule.small_fixed_assets),
            'losses_carried_forward': _money(losses_carried), 'allowances_carried_forward': _money(allowances_carried),
            'told': {'losses_brought_forward': _money(brought), 'professional_services': professional},
            'adjustments': [{'id': str(a.id), 'direction': a.direction, 'label': a.label, 'amount': _money(a.amount)} for a in adjustments],
            'books': books(session, year),
            'reviewed': rule.reviewed_at is not None,
            'note': 'An estimate from your books for you and your tax adviser to check. It follows CACU\'s reading of the Nigeria Tax Act 2025, '
                    'to be confirmed by a tax professional. CACU does not file tax returns.'}


def save_year(session, actor, year: int, data: TaxYear) -> dict:
    _require(session)
    _manager(session, actor)
    _year(year)
    raw(session, """INSERT INTO accounting.tax_year(business_id, year, losses_brought_forward, professional_services, updated_by) VALUES (%s,%s,%s,%s,%s)
        ON CONFLICT (business_id, year) DO UPDATE SET losses_brought_forward=excluded.losses_brought_forward,
        professional_services=excluded.professional_services, updated_by=excluded.updated_by, updated_at=now()""",
        (str(session.business_id), year, Decimal(data.losses_brought_forward), data.professional_services, str(actor)))
    return estimate(session, year)


def save_profile(session, actor, data: TaxProfile) -> dict:
    """Sets the month the business's accounts end in, for its tax years."""
    _require(session)
    _manager(session, actor)
    raw(session, """INSERT INTO accounting.tax_profile(business_id, year_end_month, updated_by) VALUES (%s,%s,%s)
        ON CONFLICT (business_id) DO UPDATE SET year_end_month=excluded.year_end_month, updated_by=excluded.updated_by, updated_at=now()""",
        (str(session.business_id), data.year_end_month, str(actor)))
    return {'year_end_month': data.year_end_month}


def add_adjustment(session, actor, year: int, data: Adjustment) -> dict:
    _require(session)
    _manager(session, actor)
    _year(year)
    if Decimal(data.amount) <= 0:
        raise HTTPException(422, 'Enter an amount above zero.')
    label = ' '.join(data.label.split())
    raw(session, """INSERT INTO accounting.tax_adjustment(business_id, id, year, direction, label, amount, created_by) VALUES (%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (business_id, id) DO NOTHING""", (str(session.business_id), str(data.request_key), year, data.direction, label, Decimal(data.amount), str(actor)))
    return estimate(session, year)


def remove_adjustment(session, actor, year: int, adjustment_id: UUID) -> dict:
    _require(session)
    _manager(session, actor)
    raw(session, 'DELETE FROM accounting.tax_adjustment WHERE business_id=%s AND year=%s AND id=%s', (str(session.business_id), year, str(adjustment_id)))
    return estimate(session, year)


# Income tax in the books.

ACCOUNTS = {'income_tax': 'Income tax payable', 'income_tax_expense': 'Income tax expense'}


def _owner(session, actor, what: str):
    from cacu.accounting.workflows import role
    if role(session, actor) != 'owner':
        raise HTTPException(403, f'Only the business owner can {what}.')


def _live(session, year: int):
    return raw(session, 'SELECT * FROM accounting.tax_accrual WHERE business_id=%s AND year=%s AND reversed_at IS NULL', (str(session.business_id), year)).first()


def books(session, year: int) -> dict:
    """The year's tax as posted, what has been paid on it and what is still owed."""
    tenant = str(session.business_id)
    accrual = _live(session, year)
    reversed_ = raw(session, 'SELECT posted_at, reversed_at, reversal_reason, payable FROM accounting.tax_accrual WHERE business_id=%s AND year=%s AND reversed_at IS NOT NULL ORDER BY reversed_at',
                    (tenant, year)).all()
    out = {'posted': None, 'payments': [], 'outstanding': None,
           'reversed': [{'payable': _money(r.payable), 'reversed_at': r.reversed_at.isoformat(), 'reason': r.reversal_reason} for r in reversed_]}
    if accrual is None:
        return out
    names = dict(raw(session, 'SELECT id::text, name FROM public.accounts WHERE business_id=%s', (tenant,)).all())
    paid = raw(session, 'SELECT * FROM accounting.tax_payment WHERE business_id=%s AND accrual_id=%s ORDER BY entry_date, created_at', (tenant, str(accrual.id))).all()
    owed = accrual.payable - sum((p.amount for p in paid if p.reversed_at is None), ZERO)
    out['posted'] = {'id': str(accrual.id), 'entry_date': accrual.entry_date.isoformat(), 'companies_income_tax': _money(accrual.companies_income_tax),
                     'development_levy': _money(accrual.development_levy), 'wht_used': _money(accrual.wht_used), 'payable': _money(accrual.payable),
                     'transaction_id': accrual.transaction_id, 'posted_at': accrual.posted_at.isoformat()}
    out['payments'] = [{'id': str(p.id), 'amount': _money(p.amount), 'entry_date': p.entry_date.isoformat(), 'paid_from': names.get(str(p.paid_from), 'Account'),
                        'reference': p.reference, 'reversed': p.reversed_at is not None, 'reversal_reason': p.reversal_reason} for p in paid]
    out['outstanding'] = _money(owed)
    return out


def post_tax(session, actor, year: int, request: PostTax) -> dict:
    """Posts the year's estimated tax, dated the year's last day. Posting a year again returns what was posted."""
    from cacu.accounting.assets import _ensure
    from cacu.accounting.periods import refuse_closed_month
    from cacu.accounting.posting import PostingCommand, post_command
    from cacu.accounting.tax_years import period, year_end_month
    from cacu.accounting.workflows import business_today
    _require(session)
    _owner(session, actor, 'post income tax to the books')
    _year(year)
    if _live(session, year):
        return estimate(session, year)
    _, end = period(year, year_end_month(session))
    if end >= business_today(session):
        raise HTTPException(409, 'Post the year\'s tax once the year has ended.')
    refuse_closed_month(session, end)
    view = estimate(session, year)
    cit, levy, wht = Decimal(view['companies_income_tax']), Decimal(view['development_levy']), Decimal(view['wht']['used'])
    if cit + levy <= 0:
        raise HTTPException(409, 'There is no income tax or levy to post for this year.')
    accounts = _ensure(session, actor, {'income_tax', 'income_tax_expense'}, names=ACCOUNTS)
    lines = []
    if cit + levy - wht > 0:
        lines.append({'account_id': accounts['income_tax'], 'amount': _money(cit + levy - wht), 'credited': True, 'description': f'Income tax and development levy for {year}'})
    if wht > 0:
        lines.append({'account_id': _wht_account(session), 'amount': _money(wht), 'credited': True, 'description': f'Withholding tax credits used for {year}'})
    key = request.request_key
    result = post_command(session, actor, PostingCommand(request_key=uuid5(key, 'posting'), kind='income_tax_accrual', source_id=key,
        main_account_id=accounts['income_tax_expense'], entry_date=end, narration=f'Income tax for the year to {end:%d %B %Y}', credited=False, lines=lines), internal=True)
    import json
    raw(session, """INSERT INTO accounting.tax_accrual(business_id, id, year, entry_date, companies_income_tax, development_levy, wht_used, payable, estimate, transaction_id, posted_by)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s)""",
        (str(session.business_id), str(key), year, end, cit, levy, wht, cit + levy - wht, json.dumps({k: v for k, v in view.items() if k != 'books'}),
         int(result['transaction_id']), str(actor)))
    return estimate(session, year)


def _wht_account(session):
    found = raw(session, "SELECT account_id FROM accounting.account_map WHERE business_id=%s AND purpose='wht_receivable'", (str(session.business_id),)).scalar()
    if found is None:
        raise HTTPException(409, 'Withholding tax credits need the WHT credits account: turn withholding tax on in Settings › Taxes.')
    return found


def pay_tax(session, actor, year: int, request: PayTax) -> dict:
    """Records a payment to the tax office against the year's posted tax, never more than is owed."""
    from cacu.accounting.posting import PostingCommand, post_command
    from cacu.accounting.workflows import business_today, collection_account
    _require(session)
    _manager(session, actor)
    tenant = str(session.business_id)
    if raw(session, 'SELECT 1 FROM accounting.tax_payment WHERE business_id=%s AND id=%s', (tenant, str(request.request_key))).first():
        return estimate(session, year)  # a retried request
    accrual = _live(session, year)
    if accrual is None:
        raise HTTPException(409, 'Post the year\'s tax to the books before recording payments.')
    amount = Decimal(request.amount)
    if amount <= 0:
        raise HTTPException(422, 'Enter an amount above zero.')
    if request.entry_date > business_today(session):
        raise HTTPException(422, 'A payment cannot be dated in the future.')
    left = Decimal(books(session, year)['outstanding'])
    if amount > left:
        raise HTTPException(409, f'Only ₦{left:,.2f} is still owed for this year.')
    paid_from = collection_account(session, request.method, request.bank_account_id)
    reference = (request.reference or '').strip() or None
    result = post_command(session, actor, PostingCommand(request_key=uuid5(request.request_key, 'posting'), kind='income_tax_payment', source_id=request.request_key,
        main_account_id=paid_from, entry_date=request.entry_date, credited=True, narration=f'Income tax paid for {year}' + (f' ({reference})' if reference else ''),
        lines=[{'account_id': raw(session, "SELECT account_id FROM accounting.account_map WHERE business_id=%s AND purpose='income_tax'", (tenant,)).scalar(),
                'amount': _money(amount), 'credited': False}]), internal=True)
    raw(session, """INSERT INTO accounting.tax_payment(business_id, id, accrual_id, amount, entry_date, paid_from, reference, transaction_id, created_by)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""", (tenant, str(request.request_key), str(accrual.id), amount, request.entry_date, str(paid_from), reference,
                                                 int(result['transaction_id']), str(actor)))
    return estimate(session, year)


def _reverse(session, actor, table: str, row, request: Reverse, narration: str):
    from cacu.accounting.periods import refuse_closed_month
    from cacu.accounting.posting import mirror
    from cacu.accounting.workflows import business_today
    reason = ' '.join(request.reason.split())
    if len(reason) < 5:
        raise HTTPException(422, 'Say why it is being reversed.')
    today = business_today(session)
    refuse_closed_month(session, today)
    result = mirror(session, actor, row.transaction_id, 'tax_reversal', uuid5(request.request_key, 'posting'), uuid5(UUID(str(row.id)), 'reversal'), today, narration)
    raw(session, f'UPDATE accounting.{table} SET reversed_at=now(), reversal_reason=%s, reversal_transaction_id=%s, reversed_by=%s WHERE business_id=%s AND id=%s',
        (reason, int(result['transaction_id']), str(actor), str(session.business_id), str(row.id)))


def reverse_tax(session, actor, year: int, request: Reverse) -> dict:
    """Reverses the year's posted tax while nothing is paid on it, so a changed estimate can be posted again."""
    _require(session)
    _owner(session, actor, 'reverse income tax in the books')
    accrual = _live(session, year)
    if accrual is None:
        return estimate(session, year)  # nothing posted, or reversed already
    if raw(session, 'SELECT 1 FROM accounting.tax_payment WHERE business_id=%s AND accrual_id=%s AND reversed_at IS NULL', (str(session.business_id), str(accrual.id))).first():
        raise HTTPException(409, 'Payments have been recorded against this year\'s tax. Reverse them first.')
    _reverse(session, actor, 'tax_accrual', accrual, request, f'Reversed: income tax for {year}')
    return estimate(session, year)


def reverse_tax_payment(session, actor, year: int, payment_id: UUID, request: Reverse) -> dict:
    """Reverses a tax payment recorded in error: what it paid is owed again."""
    _require(session)
    _owner(session, actor, 'reverse a tax payment')
    payment = raw(session, """SELECT p.* FROM accounting.tax_payment p JOIN accounting.tax_accrual a ON a.business_id=p.business_id AND a.id=p.accrual_id
        WHERE p.business_id=%s AND p.id=%s AND a.year=%s""", (str(session.business_id), str(payment_id), year)).first()
    if payment is None:
        raise HTTPException(404, 'Tax payment not found')
    if payment.reversed_at is None:
        _reverse(session, actor, 'tax_payment', payment, request, f'Reversed (recorded in error): income tax paid for {year}')
    return estimate(session, year)
