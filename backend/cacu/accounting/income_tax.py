"""Company income tax estimate (R4; Nigeria Tax Act 2025, effective 1 January 2026).

A yearly estimate from the books, every step shown, for the owner and their tax adviser. Nothing posts to the ledger
and CACU files nothing. Off until a tax professional reviews it (accounting.income_tax_switch); on for CACU's preview
business. Tax years are calendar years: accounts made up to 31 December.

    Profit before tax (from the books)
  + depreciation in the books (replaced by capital allowances)
  - book gain on disposals / + book loss (replaced by balancing charges and allowances)
  + expenses the law does not allow   - income that is not taxable       (entered by the owner)
  = adjusted profit
  - losses brought forward (losses are carried forward indefinitely)
  = assessable profit                                   -> development levy 4% (if not a small company)
  + balancing charges  - capital allowances  - balancing allowances
  = total profits                                       -> companies income tax 30% (if not a small company)

Owner decisions of 26 November 2026: a small company has turnover up to N50 million (the Act's text; the June 2026
transition guidelines say N100 million) and fixed assets up to N250 million, and is not a professional services firm;
it pays neither. The figures live in one reviewed row, accounting.income_tax_rule. The fixed assets test uses the
carrying amount in the books at the year's end; whether cost is meant is for the reviewer.
"""
from datetime import date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal
from uuid import UUID
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
    tenant = str(session.business_id)
    start, end = date(year, 1, 1), date(year, 12, 31)
    rule = raw(session, 'SELECT * FROM accounting.income_tax_rule WHERE singleton').first()
    told = raw(session, 'SELECT * FROM accounting.tax_year WHERE business_id=%s AND year=%s', (tenant, year)).first()
    adjustments = raw(session, 'SELECT * FROM accounting.tax_adjustment WHERE business_id=%s AND year=%s ORDER BY created_at', (tenant, year)).all()

    profit = -_sum(session, start, end, 'a.account_type::text = ANY(%s)', (list(PROFIT_TYPES),))
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

    steps = [('Profit before tax, from the books', profit), ('Add: depreciation in the books', depreciation),
             ('Less: book gain on disposals' if disposal_gain >= 0 else 'Add: book loss on disposals', -disposal_gain),
             ('Add: expenses the law does not allow', added), ('Less: income that is not taxable', -deducted),
             ('Adjusted profit', adjusted), ('Less: losses brought forward used', -(brought - losses_carried) if adjusted >= 0 else ZERO),
             ('Assessable profit', assessable), ('Add: balancing charges', charge), ('Less: capital allowances', -capital_allowance),
             ('Less: balancing allowances', -balancing_allowance), ('Total profits', total_profits)]
    return {'year': year, 'small_company': small, 'not_small_because': reasons,
            'turnover': _money(turnover), 'fixed_assets': _money(fixed_assets),
            'steps': [{'label': label, 'amount': _money(value)} for label, value in steps if label in {'Adjusted profit', 'Assessable profit', 'Total profits', 'Profit before tax, from the books'} or value],
            'companies_income_tax': _money(cit), 'development_levy': _money(levy), 'total_due': _money(cit + levy),
            'cit_rate_percent': _money(rule.cit_rate * 100), 'levy_rate_percent': _money(rule.levy_rate * 100),
            'small_turnover': _money(rule.small_turnover), 'small_fixed_assets': _money(rule.small_fixed_assets),
            'losses_carried_forward': _money(losses_carried), 'allowances_carried_forward': _money(allowances_carried),
            'told': {'losses_brought_forward': _money(brought), 'professional_services': professional},
            'adjustments': [{'id': str(a.id), 'direction': a.direction, 'label': a.label, 'amount': _money(a.amount)} for a in adjustments],
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
