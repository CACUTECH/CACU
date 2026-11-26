"""Capital allowances (R4; Nigeria Tax Act 2025, effective 1 January 2026): tax depreciation on the fixed asset register,
kept apart from book depreciation, for the company income tax computation. Nothing here posts to the ledger.

CACU's reading of the Act, to be confirmed by a tax professional before release (accounting.capital_allowance_switch
stays off until then; it is on for CACU's preview business):

* No initial allowance. An **annual allowance**, straight-line on the qualifying cost, at the rate of the asset's
  class: 10% (buildings, masts, heavy transport, intangibles, agricultural), 20% (plant, furniture and fittings,
  mining, other equipment) or 25% (motor vehicles, software, other capital expenditure).
* A full year's allowance in each tax year the asset is held at the year's end, starting with the year it was bought
  (or brought into CACU), and none in the year it is disposed of.
* **1% of the cost** stays as the tax written-down value until disposal, so at most 99% is ever allowed.
* An asset **qualifies** only where any VAT due on it was charged, or import duty paid where imported. The owner
  marks an asset that does not.
* On **disposal**, proceeds above the tax written-down value are a balancing charge (taxable); below it, a balancing
  allowance. Whether the Act still gives a balancing allowance is for the reviewer to confirm.
* An asset owned before CACU carries the allowances already claimed on it under earlier law; only what is left of
  the 99% is allowed.

Tax years are calendar years: the computation assumes accounts made up to 31 December.
"""
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from cacu.accounting.posting import raw

ZERO = Decimal('0')
CENT = Decimal('0.01')
RETAINED = Decimal('0.01')
OFF_MESSAGE = 'Capital allowances are not available yet.'
# The class each kind of asset takes unless the owner chooses another.
DEFAULT_CLASS = {'buildings': 'building', 'vehicles': 'motor_vehicle', 'machinery': 'plant', 'furniture': 'furniture',
                 'computers': 'other_equipment', 'other': 'other_capital'}


class AssetTax(BaseModel):
    model_config = ConfigDict(extra='forbid')
    tax_class: str = Field(pattern=r'^[a-z_]{2,40}$')
    qualifies: bool = True
    claimed_before: str = Field(default='0.00', pattern=r'^[0-9]{1,13}(\.[0-9]{1,2})?$')
    note: str | None = Field(default=None, max_length=500)


def enabled(session) -> bool:
    return bool(raw(session, 'SELECT (SELECT enabled FROM accounting.capital_allowance_switch WHERE singleton) OR accounting.is_preview(%s)',
                    (str(session.business_id),)).scalar())


def _require(session):
    if not enabled(session):
        raise HTTPException(409, OFF_MESSAGE)


def _money(value: Decimal) -> str:
    return format(value.quantize(CENT), 'f')


def rates(session) -> dict:
    return {r.tax_class: r for r in raw(session, 'SELECT * FROM accounting.capital_allowance_rate ORDER BY act_class, label').all()}


def _settings(session) -> dict:
    return {str(r.asset_id): r for r in raw(session, 'SELECT * FROM accounting.asset_tax WHERE business_id=%s', (str(session.business_id),)).all()}


def computation(asset, rate: Decimal, claimed_before: Decimal, year: int) -> dict | None:
    """The asset's allowance for one tax year, or None when it was not held in that year at all."""
    start = asset.depreciate_from.year
    gone = asset.disposed_on.year if asset.disposed_on else None
    if year < start or (gone is not None and year > gone):
        return None
    cost = asset.cost
    annual = (cost * rate).quantize(CENT, ROUND_HALF_UP)
    remaining = max(cost * (1 - RETAINED) - claimed_before, ZERO).quantize(CENT, ROUND_HALF_UP)
    written_down = cost - claimed_before
    for y in range(start, year + 1):
        opening = written_down
        if gone == y:
            proceeds = asset.disposal_proceeds
            return {'opening': opening, 'allowance': ZERO, 'proceeds': proceeds, 'balancing': proceeds - opening, 'closing': ZERO}
        allowance = min(annual, remaining)
        remaining -= allowance
        written_down -= allowance
        if y == year:
            return {'opening': opening, 'allowance': allowance, 'proceeds': None, 'balancing': ZERO, 'closing': written_down}
    return None


def schedule(session, year: int) -> dict:
    """Every asset's capital allowance for a tax year, with the totals for the tax computation."""
    _require(session)
    return figures(session, year)


def figures(session, year: int) -> dict:
    """The schedule itself, also used by the income tax estimate."""
    from cacu.accounting.assets import _assets
    if not 2026 <= year <= 2100:
        raise HTTPException(422, 'Capital allowances start with 2026, when the Nigeria Tax Act 2025 took effect.')
    table, settings = rates(session), _settings(session)
    rows, totals = [], {'allowance': ZERO, 'balancing_charge': ZERO, 'balancing_allowance': ZERO}
    for asset in _assets(session):
        chosen = settings.get(str(asset.id))
        tax_class = chosen.tax_class if chosen else DEFAULT_CLASS[asset.category]
        qualifies = chosen.qualifies if chosen else True
        rate = table[tax_class].rate
        figures = computation(asset, rate, chosen.claimed_before if chosen else ZERO, year)
        if figures is None:
            continue
        row = {'asset_id': str(asset.id), 'name': asset.name, 'category': asset.category, 'tax_class': tax_class,
               'class_label': table[tax_class].label, 'rate_percent': _money(rate * 100), 'qualifies': qualifies,
               'cost': _money(asset.cost), 'claimed_before': _money(chosen.claimed_before if chosen else ZERO),
               'note': chosen.note if chosen else None, 'set': chosen is not None}
        if qualifies:
            row.update({k: (_money(v) if v is not None else None) for k, v in figures.items()})
            totals['allowance'] += figures['allowance']
            if figures['balancing'] > 0:
                totals['balancing_charge'] += figures['balancing']
            elif figures['balancing'] < 0:
                totals['balancing_allowance'] -= figures['balancing']
        rows.append(row)
    unreviewed = any(r.reviewed_at is None for r in table.values())
    return {'year': year, 'assets': rows, 'totals': {k: _money(v) for k, v in totals.items()},
            'classes': [{'tax_class': k, 'label': r.label, 'rate_percent': _money(r.rate * 100)} for k, r in table.items()],
            'reviewed': not unreviewed,
            'note': 'Prepared from your fixed asset register for your tax computation. The rates follow CACU\'s reading of the '
                    'Nigeria Tax Act 2025 and are to be confirmed by a tax professional. CACU does not file tax returns.'}


def save(session, actor, asset_id: UUID, data: AssetTax) -> dict:
    """Sets an asset's tax class, whether it qualifies, and allowances already claimed before CACU."""
    from cacu.accounting.workflows import role
    _require(session)
    if role(session, actor) not in {'owner', 'admin'}:
        raise HTTPException(403, 'Only the business owner or an Admin can change how an asset is treated for tax.')
    tenant = str(session.business_id)
    asset = raw(session, 'SELECT * FROM accounting.fixed_asset WHERE business_id=%s AND id=%s', (tenant, str(asset_id))).first()
    if asset is None:
        raise HTTPException(404, 'Fixed asset not found')
    if data.tax_class not in rates(session):
        raise HTTPException(422, 'Choose a capital allowance class.')
    claimed = Decimal(data.claimed_before)
    if claimed and asset.how != 'existing':
        raise HTTPException(422, 'Only an asset owned before CACU can have allowances already claimed.')
    if claimed > asset.cost * (1 - RETAINED):
        raise HTTPException(422, 'Allowances already claimed cannot be more than 99% of the cost.')
    note = (data.note or '').strip() or None
    raw(session, """INSERT INTO accounting.asset_tax(business_id, asset_id, tax_class, qualifies, claimed_before, note, updated_by)
        VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (business_id, asset_id) DO UPDATE SET tax_class=excluded.tax_class,
        qualifies=excluded.qualifies, claimed_before=excluded.claimed_before, note=excluded.note, updated_by=excluded.updated_by, updated_at=now()""",
        (tenant, str(asset_id), data.tax_class, data.qualifies, claimed, note, str(actor)))
    return {'asset_id': str(asset_id), 'tax_class': data.tax_class, 'qualifies': data.qualifies, 'claimed_before': _money(claimed), 'note': note}

