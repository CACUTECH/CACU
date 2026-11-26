"""Fixed assets (Doc 10 R4; IAS 16): the asset register, monthly depreciation and disposals.

Owner decisions of 26 November 2026:

* An asset is bought **paid** (debit its cost, credit the till or a bank), **on credit** (a supplier bill for its cost,
  listed and paid with the other bills), or was **already owned** before the books started in CACU. A business
  registered for VAT claims the input VAT on what it buys, as on any bill or expense: the cost is before VAT and the
  VAT goes to Input VAT, in the month's VAT return. That one is
  brought in with its depreciation to date: debit its cost, credit its accumulated depreciation and retained earnings.
  It is the position brought in, so the cash flow statement leaves it out, as it does the opening position.
* **Straight-line** charges (cost less residual value) evenly over the useful life; **reducing balance** charges a
  yearly rate on the carrying amount. Both are charged monthly, from the month the asset is bought or brought in, and
  never below its residual value. Nothing is charged in the month an asset is disposed of.
* An Owner or Admin **posts each month's depreciation** for every asset as one journal, dated the month's last day:
  debit Depreciation, credit each category's accumulated depreciation. Months are posted in order, once each, and
  only once they have ended. Month close refuses a month that needs depreciation and has none posted.
* A **disposal** takes the asset out of the books: debit its accumulated depreciation and any proceeds, credit its
  cost; the difference is a gain or loss on disposal.

The register, its runs and disposals are fixed once made; a mistake is reversed by a journal.
"""
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal
from uuid import UUID, uuid5
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from cacu.accounting.posting import ASSET_CATEGORIES, PostingCommand, post_command, raw

ZERO = Decimal('0')
CENT = Decimal('0.01')
AMOUNT = r'^[0-9]{1,13}(\.[0-9]{1,2})?$'
ROLE_MESSAGE = 'Only the business owner or an Admin can change fixed assets.'
CATEGORY_NAMES = {'buildings': 'Land and buildings', 'vehicles': 'Motor vehicles', 'machinery': 'Plant and machinery',
                  'furniture': 'Furniture and fittings', 'computers': 'Computers and phones', 'other': 'Other equipment'}
ACCOUNT_NAMES = {**{f'asset_{c}': n for c, n in CATEGORY_NAMES.items()},
                 **{f'accdep_{c}': f'Accumulated depreciation: {n.lower()}' for c, n in CATEGORY_NAMES.items()},
                 'depreciation': 'Depreciation', 'disposal_gains': 'Gains and losses on disposal of assets'}
Category = Literal['buildings', 'vehicles', 'machinery', 'furniture', 'computers', 'other']


class AddAsset(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: UUID
    name: str = Field(min_length=1, max_length=120)
    category: Category
    reference: str | None = Field(default=None, max_length=60)
    acquired_on: date
    cost: str = Field(pattern=AMOUNT)
    residual: str = Field(default='0.00', pattern=AMOUNT)
    method: Literal['straight_line', 'reducing_balance']
    useful_life_months: int | None = Field(default=None, ge=1, le=1200)
    annual_rate_percent: str | None = Field(default=None, pattern=r'^[0-9]{1,3}(\.[0-9]{1,2})?$')
    how: Literal['paid', 'credit', 'existing']
    # Bought paid or on credit by a business registered for VAT: the VAT on the supplier's bill, on top of the cost.
    vat: str = Field(default='0.00', pattern=AMOUNT)
    # Paid: from the till (Cash) or a bank (Transfer).
    pay_method: Literal['Cash', 'Transfer'] | None = None
    bank_account_id: UUID | None = None
    # On credit: the supplier and their bill.
    supplier_id: UUID | None = None
    bill_number: str | None = Field(default=None, max_length=100)
    due_date: date | None = None
    # Already owned: depreciation to the end of the month before it is brought in, and the day it is brought in.
    accumulated_depreciation: str = Field(default='0.00', pattern=AMOUNT)
    brought_in_on: date | None = None

    @field_validator('name')
    @classmethod
    def _name(cls, value):
        value = ' '.join(value.split())
        if not value:
            raise ValueError('Enter the asset name')
        return value

    @model_validator(mode='after')
    def _shape(self):
        if self.method == 'straight_line' and self.useful_life_months is None:
            raise ValueError('Enter the useful life in months')
        if self.method == 'reducing_balance' and (self.annual_rate_percent is None or not ZERO < Decimal(self.annual_rate_percent) <= 100):
            raise ValueError('Enter a yearly rate above 0% and up to 100%')
        return self


class Dispose(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: UUID
    disposed_on: date
    proceeds: str = Field(default='0.00', pattern=AMOUNT)
    method: Literal['Cash', 'Transfer'] | None = None
    bank_account_id: UUID | None = None


class PostDepreciation(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: UUID


def _money(value: Decimal) -> str:
    return format(value.quantize(CENT), 'f')


def _months(start: date, end: date) -> int:
    """Whole months from the month of start to the month of end."""
    return (end.year - start.year) * 12 + end.month - start.month


def _month(value: str) -> date:
    try:
        year, month = (int(p) for p in value.split('-'))
        return date(year, month, 1)
    except (ValueError, TypeError):
        raise HTTPException(422, 'Choose a month as YYYY-MM') from None


def _allowed(session, actor):
    from cacu.accounting.workflows import role
    if role(session, actor) not in {'owner', 'admin'}:
        raise HTTPException(403, ROLE_MESSAGE)


def _purpose(session, name):
    rows = raw(session, 'SELECT account_id FROM accounting.account_map WHERE business_id=%s AND purpose=%s', (str(session.business_id), name)).all()
    return rows[0].account_id if len(rows) == 1 else None


def _ensure(session, actor, kinds):
    """Adds the fixed asset accounts these entries need to the chart, once (the same request key each time)."""
    from cacu.accounting.accounts import add_account
    tenant = str(session.business_id)
    for kind in sorted(kinds):
        if _purpose(session, kind) is None:
            add_account(session, actor, uuid5(UUID(int=0), f'cacu:{kind}:{tenant}'), kind, ACCOUNT_NAMES[kind])
        if _purpose(session, kind) is None:
            raise HTTPException(409, f'{ACCOUNT_NAMES[kind]} could not be added to your chart')
    return {kind: _purpose(session, kind) for kind in kinds}


def _cutover(session) -> date:
    cutover = raw(session, "SELECT cutover_date FROM accounting.business_map WHERE business_id=%s AND state='active'", (str(session.business_id),)).scalar()
    if cutover is None:
        raise HTTPException(409, 'Start your books before adding fixed assets.')
    return cutover


def _open_date(session, day: date, what: str):
    from cacu.accounting.periods import refuse_closed_month
    from cacu.accounting.workflows import business_today
    if day > business_today(session):
        raise HTTPException(422, f'{what} cannot be in the future.')
    if day < _cutover(session):
        raise HTTPException(422, f'{what} cannot be before your books started in CACU.')
    refuse_closed_month(session, day)


# The register and its depreciation.

def _assets(session):
    return raw(session, 'SELECT * FROM accounting.fixed_asset WHERE business_id=%s ORDER BY acquired_on, created_at', (str(session.business_id),)).all()


def _charged(session) -> dict:
    """Depreciation posted so far, by asset."""
    return {str(r.asset_id): r.total for r in raw(session, 'SELECT asset_id, sum(amount) total FROM accounting.depreciation_charge WHERE business_id=%s GROUP BY asset_id',
                                                  (str(session.business_id),)).all()}


def _runs(session) -> dict:
    return {r.month: r for r in raw(session, 'SELECT * FROM accounting.depreciation_run WHERE business_id=%s ORDER BY month', (str(session.business_id),)).all()}


def chargeable(asset, month: date) -> bool:
    """Whether depreciation is due for the asset in this month at all."""
    return asset.depreciate_from <= month and (asset.disposed_on is None or month < asset.disposed_on.replace(day=1))


def charge(asset, month: date, accumulated: Decimal) -> Decimal:
    """The month's depreciation for one asset, given all depreciation to date (brought in and posted)."""
    if not chargeable(asset, month):
        return ZERO
    carrying = asset.cost - accumulated
    left = carrying - asset.residual
    if left <= 0:
        return ZERO
    if asset.method == 'reducing_balance':
        return min((carrying * asset.annual_rate / 12).quantize(CENT, ROUND_HALF_UP), left)
    # Straight-line over what is left of the useful life when CACU starts charging; the last month takes what remains.
    life_left = max(asset.useful_life_months - _months(asset.acquired_on, asset.depreciate_from), 1)
    used = _months(asset.depreciate_from, month)
    if used >= life_left - 1:
        return left
    planned = ((asset.cost - asset.opening_accumulated - asset.residual) / life_left).quantize(CENT, ROUND_HALF_UP)
    return min(planned, left)


def _view(asset, charged: dict) -> dict:
    accumulated = asset.opening_accumulated + charged.get(str(asset.id), ZERO)
    out = {'id': str(asset.id), 'name': asset.name, 'category': asset.category, 'category_name': CATEGORY_NAMES[asset.category],
           'reference': asset.reference, 'acquired_on': asset.acquired_on.isoformat(), 'how': asset.how, 'method': asset.method,
           'useful_life_months': asset.useful_life_months, 'annual_rate_percent': _money(asset.annual_rate * 100) if asset.annual_rate is not None else None,
           'cost': _money(asset.cost), 'residual': _money(asset.residual), 'accumulated_depreciation': _money(accumulated),
           'carrying_amount': _money(asset.cost - accumulated), 'depreciate_from': asset.depreciate_from.strftime('%Y-%m'),
           'disposed_on': asset.disposed_on.isoformat() if asset.disposed_on else None,
           'disposal_proceeds': _money(asset.disposal_proceeds) if asset.disposal_proceeds is not None else None}
    if asset.disposed_on:
        out['carrying_amount'] = '0.00'
        out['disposal_result'] = _money(asset.disposal_proceeds - (asset.cost - accumulated))
    return out


def due_months(session, today: date | None = None) -> list[date]:
    """Ended months that need depreciation and have none posted yet, oldest first."""
    from cacu.accounting.periods import month_end, next_month
    from cacu.accounting.workflows import business_today
    today = today or business_today(session)
    assets = _assets(session)
    if not assets:
        return []
    runs = _runs(session)
    month, due = min(a.depreciate_from for a in assets), []
    while month_end(month) <= today:
        if month not in runs and any(chargeable(a, month) for a in assets):
            due.append(month)
        month = next_month(month)
    return due


def needs_depreciation(session, month: date) -> bool:
    """For month close: the month has assets to depreciate and no depreciation posted."""
    if month in _runs(session):
        return False
    return any(chargeable(a, month) for a in _assets(session))


def _allowances_on(session) -> bool:
    from cacu.accounting.allowances import enabled
    return enabled(session)


def overview(session) -> dict:
    from cacu.accounting.workflows import bank_accounts
    charged = _charged(session)
    assets = [_view(a, charged) for a in _assets(session)]
    runs = [{'month': m.strftime('%Y-%m'), 'entry_date': r.entry_date.isoformat(), 'total': _money(r.total), 'transaction_id': r.transaction_id,
             'posted_at': r.posted_at.isoformat()} for m, r in sorted(_runs(session).items(), reverse=True)]
    live = [a for a in assets if a['disposed_on'] is None]
    return {'assets': assets, 'runs': runs[:24], 'due': [m.strftime('%Y-%m') for m in due_months(session)],
            'totals': {'cost': _money(sum((Decimal(a['cost']) for a in live), ZERO)),
                       'accumulated_depreciation': _money(sum((Decimal(a['accumulated_depreciation']) for a in live), ZERO)),
                       'carrying_amount': _money(sum((Decimal(a['carrying_amount']) for a in live), ZERO))},
            'capital_allowances': _allowances_on(session),
            'categories': CATEGORY_NAMES, 'pay_from': {'cash': _purpose(session, 'cash') is not None, 'banks': bank_accounts(session)}}


def preview(session, value: str) -> dict:
    """What posting a month would charge, asset by asset."""
    month = _month(value)
    charged = _charged(session)
    rows = []
    for a in _assets(session):
        amount = charge(a, month, a.opening_accumulated + charged.get(str(a.id), ZERO))
        if amount > 0:
            rows.append({'asset_id': str(a.id), 'name': a.name, 'category_name': CATEGORY_NAMES[a.category], 'amount': _money(amount)})
    return {'month': value, 'charges': rows, 'total': _money(sum((Decimal(r['amount']) for r in rows), ZERO))}


# Adding an asset.

def add_asset(session, actor, data: AddAsset) -> dict:
    from cacu.accounting.workflows import collection_account, party_account
    _allowed(session, actor)
    tenant = str(session.business_id)
    existing = raw(session, 'SELECT * FROM accounting.fixed_asset WHERE business_id=%s AND id=%s', (tenant, str(data.request_key))).first()
    if existing:
        return _view(existing, _charged(session))  # a retried request
    cost, residual, opening, vat_amount = Decimal(data.cost), Decimal(data.residual), Decimal(data.accumulated_depreciation), Decimal(data.vat)
    if cost <= 0:
        raise HTTPException(422, 'Enter the cost, above zero.')
    if residual >= cost:
        raise HTTPException(422, 'The residual value must be less than the cost.')
    cutover = _cutover(session)
    if data.how == 'existing':
        if data.acquired_on >= cutover:
            raise HTTPException(422, 'This asset was bought after your books started in CACU: record it as paid or bought on credit.')
        if data.brought_in_on is None:
            raise HTTPException(422, 'Choose the day the asset is brought into the books.')
        if opening > cost - residual:
            raise HTTPException(422, 'Depreciation to date cannot be more than the cost less the residual value.')
        if vat_amount:
            raise HTTPException(422, 'An asset owned before your books started has no VAT to claim now.')
        _open_date(session, data.brought_in_on, 'The day it is brought in')
        entry_date, depreciate_from = data.brought_in_on, data.brought_in_on.replace(day=1)
    else:
        if opening:
            raise HTTPException(422, 'Only an asset owned before your books started has depreciation to date.')
        _open_date(session, data.acquired_on, 'The purchase date')
        entry_date, depreciate_from = data.acquired_on, data.acquired_on.replace(day=1)
    category = data.category
    needed = {f'asset_{category}'} | ({f'accdep_{category}'} if data.how == 'existing' and opening > 0 else set())
    accounts = _ensure(session, actor, needed)
    cost_account = accounts[f'asset_{category}']
    key = data.request_key
    narration = f'Fixed asset: {data.name}'
    supplier = None
    figures = None
    purchase = [{'account_id': cost_account, 'amount': _money(cost), 'description': narration}]
    if data.how != 'existing':
        from cacu.accounting import vat
        figures = vat.input_vat(session, entry_date, cost, vat_amount, False)
        if figures.vat > 0:
            purchase.append(vat.input_line(session, figures.vat, f'{narration}: VAT'))
    if data.how == 'paid':
        if data.pay_method is None:
            raise HTTPException(422, 'Choose whether it was paid from the till or a bank.')
        paid_from = collection_account(session, data.pay_method, data.bank_account_id)
        result = post_command(session, actor, PostingCommand(request_key=uuid5(key, 'posting'), kind='asset_purchase', source_id=key,
            main_account_id=paid_from, entry_date=entry_date, narration=narration, credited=True, lines=purchase), internal=True)
    elif data.how == 'credit':
        number = (data.bill_number or '').strip()
        if data.supplier_id is None or not number:
            raise HTTPException(422, "Choose the supplier and enter their bill number.")
        if data.due_date and data.due_date < data.acquired_on:
            raise HTTPException(422, 'The due date cannot be before the purchase date.')
        if not raw(session, 'SELECT 1 FROM public.suppliers WHERE id=%s AND business_id=%s', (str(data.supplier_id), tenant)).first():
            raise HTTPException(422, 'Supplier unavailable')
        if raw(session, 'SELECT 1 FROM accounting.supplier_bill WHERE business_id=%s AND supplier_id=%s AND lower(btrim(bill_number))=lower(%s)',
               (tenant, str(data.supplier_id), number)).first():
            raise HTTPException(409, "This supplier's bill with that number is already recorded")
        supplier = data.supplier_id
        payables = party_account(session, 'suppliers', supplier)
        raw(session, 'INSERT INTO accounting.supplier_bill(business_id,id,supplier_id,bill_number,bill_date,due_date,notes,created_by) VALUES(%s,%s,%s,%s,%s,%s,%s,%s)',
            (tenant, str(key), str(supplier), number, data.acquired_on, data.due_date, narration, str(actor)))
        result = post_command(session, actor, PostingCommand(request_key=uuid5(key, 'posting'), kind='bill', source_id=key, main_account_id=payables,
            entry_date=entry_date, narration=f'Bill {number}: {data.name}', counterparty_id=supplier, lines=purchase))
    else:
        lines = []
        if opening > 0:
            lines.append({'account_id': accounts[f'accdep_{category}'], 'amount': _money(opening), 'credited': True, 'description': f'{data.name}: depreciation to date'})
        retained = _purpose(session, 'retained_earnings')
        if retained is None:
            raise HTTPException(409, 'Your chart needs a Retained earnings account to bring in assets you already owned.')
        lines.append({'account_id': retained, 'amount': _money(cost - opening), 'credited': True, 'description': f'{data.name}: owned before CACU'})
        result = post_command(session, actor, PostingCommand(request_key=uuid5(key, 'posting'), kind='asset_opening', source_id=key,
            main_account_id=cost_account, entry_date=entry_date, narration=f'{narration} (owned before CACU)', credited=False, lines=lines), internal=True)
    if figures is not None:
        from cacu.accounting import vat
        vat.record(session, 'bill' if data.how == 'credit' else 'asset_purchase', key, 'input', entry_date, figures, cost, False)
    rate = (Decimal(data.annual_rate_percent) / 100) if data.method == 'reducing_balance' else None
    raw(session, """INSERT INTO accounting.fixed_asset(business_id, id, name, category, reference, acquired_on, cost, residual, method, useful_life_months,
        annual_rate, how, depreciate_from, opening_accumulated, supplier_id, transaction_id, created_by)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (tenant, str(key), data.name, category, (data.reference or '').strip() or None, data.acquired_on, cost, residual, data.method,
         data.useful_life_months if data.method == 'straight_line' else None, rate, data.how, depreciate_from, opening,
         str(supplier) if supplier else None, int(result['transaction_id']), str(actor)))
    row = raw(session, 'SELECT * FROM accounting.fixed_asset WHERE business_id=%s AND id=%s', (tenant, str(key))).first()
    return _view(row, _charged(session))


# Posting a month's depreciation.

def post_month(session, actor, value: str, data: PostDepreciation) -> dict:
    from cacu.accounting.periods import month_end, refuse_closed_month
    from cacu.accounting.workflows import business_today
    _allowed(session, actor)
    tenant = str(session.business_id)
    month = _month(value)
    runs = _runs(session)
    if month in runs:
        return preview(session, value) | {'posted': True}  # posted already, by this request or another
    end = month_end(month)
    if end > business_today(session):
        raise HTTPException(409, 'Depreciation is posted once the month has ended.')
    assets = _assets(session)
    if not any(chargeable(a, month) for a in assets):
        raise HTTPException(409, 'No assets are depreciated in this month.')
    earlier = [m for m in due_months(session) if m < month]
    if earlier:
        raise HTTPException(409, f"Post depreciation for {earlier[0]:%B %Y} first: months are posted in order.")
    refuse_closed_month(session, end)
    charged = _charged(session)
    charges = {}
    for a in assets:
        amount = charge(a, month, a.opening_accumulated + charged.get(str(a.id), ZERO))
        if amount > 0:
            charges[a] = amount
    total = sum(charges.values(), ZERO)
    transaction_id = None
    if total > 0:
        categories = sorted({a.category for a in charges})
        accounts = _ensure(session, actor, {'depreciation'} | {f'accdep_{c}' for c in categories})
        lines = [{'account_id': accounts[f'accdep_{c}'], 'amount': _money(sum((v for a, v in charges.items() if a.category == c), ZERO)), 'credited': True,
                  'description': f'Depreciation: {CATEGORY_NAMES[c].lower()}'} for c in categories]
        source = uuid5(UUID(tenant), f'depreciation:{month:%Y-%m}')
        result = post_command(session, actor, PostingCommand(request_key=uuid5(data.request_key, 'posting'), kind='depreciation', source_id=source,
            main_account_id=accounts['depreciation'], entry_date=end, narration=f'Depreciation for {month:%B %Y}', credited=False, lines=lines), internal=True)
        transaction_id = int(result['transaction_id'])
    raw(session, 'INSERT INTO accounting.depreciation_run(business_id, month, entry_date, total, transaction_id, posted_by) VALUES (%s,%s,%s,%s,%s,%s)',
        (tenant, month, end, total, transaction_id, str(actor)))
    for a, amount in charges.items():
        raw(session, 'INSERT INTO accounting.depreciation_charge(business_id, month, asset_id, amount) VALUES (%s,%s,%s,%s)', (tenant, month, str(a.id), amount))
    return {'month': value, 'total': _money(total), 'transaction_id': transaction_id, 'posted': True,
            'charges': [{'asset_id': str(a.id), 'name': a.name, 'amount': _money(v)} for a, v in charges.items()]}


# Disposing of an asset.

def dispose(session, actor, asset_id: UUID, data: Dispose) -> dict:
    from cacu.accounting.workflows import collection_account
    _allowed(session, actor)
    tenant = str(session.business_id)
    asset = raw(session, 'SELECT * FROM accounting.fixed_asset WHERE business_id=%s AND id=%s', (tenant, str(asset_id))).first()
    if asset is None:
        raise HTTPException(404, 'Fixed asset not found')
    if asset.disposed_on is not None:
        if raw(session, "SELECT 1 FROM accounting.document_map WHERE business_id=%s AND source_type='asset_disposal' AND source_id=%s",
               (tenant, str(data.request_key))).first():
            return _view(asset, _charged(session))  # a retried request
        raise HTTPException(409, 'This asset has already been disposed of.')
    proceeds = Decimal(data.proceeds)
    _open_date(session, data.disposed_on, 'The disposal date')
    month = data.disposed_on.replace(day=1)
    if month < asset.depreciate_from:
        raise HTTPException(422, 'An asset cannot be disposed of before it was bought or brought in.')
    earlier = [m for m in due_months(session) if m < month]
    if earlier:
        raise HTTPException(409, f'Post depreciation for {earlier[0]:%B %Y} first, so the asset is disposed of at its carrying amount.')
    if month in _runs(session) and raw(session, 'SELECT 1 FROM accounting.depreciation_charge WHERE business_id=%s AND month=%s AND asset_id=%s',
                                      (tenant, month, str(asset.id))).first():
        raise HTTPException(409, f'Depreciation for {month:%B %Y} is already posted for this asset: date the disposal in a later month.')
    accumulated = asset.opening_accumulated + _charged(session).get(str(asset.id), ZERO)
    carrying = asset.cost - accumulated
    accounts = _ensure(session, actor, {f'asset_{asset.category}'} | ({f'accdep_{asset.category}'} if accumulated > 0 else set())
                       | ({'disposal_gains'} if proceeds != carrying else set()))
    lines = []
    if accumulated > 0:
        lines.append({'account_id': accounts[f'accdep_{asset.category}'], 'amount': _money(accumulated), 'credited': False, 'description': f'{asset.name}: depreciation to date'})
    if proceeds > 0:
        if data.method is None:
            raise HTTPException(422, 'Choose whether the money came into the till or a bank.')
        lines.append({'account_id': collection_account(session, data.method, data.bank_account_id), 'amount': _money(proceeds), 'credited': False,
                      'description': f'{asset.name}: sold'})
    result_amount = proceeds - carrying
    if result_amount != 0:
        lines.append({'account_id': accounts['disposal_gains'], 'amount': _money(abs(result_amount)), 'credited': result_amount > 0,
                      'description': f"{asset.name}: {'gain' if result_amount > 0 else 'loss'} on disposal"})
    result = post_command(session, actor, PostingCommand(request_key=uuid5(data.request_key, 'posting'), kind='asset_disposal', source_id=data.request_key,
        main_account_id=accounts[f'asset_{asset.category}'], entry_date=data.disposed_on, narration=f'Disposal: {asset.name}', credited=True,
        main_amount=_money(asset.cost), lines=lines), internal=True)
    raw(session, """UPDATE accounting.fixed_asset SET disposed_on=%s, disposal_proceeds=%s, disposal_transaction_id=%s, disposed_by=%s
        WHERE business_id=%s AND id=%s""", (data.disposed_on, proceeds, int(result['transaction_id']), str(actor), tenant, str(asset.id)))
    row = raw(session, 'SELECT * FROM accounting.fixed_asset WHERE business_id=%s AND id=%s', (tenant, str(asset.id))).first()
    return _view(row, _charged(session))


def disposal_transactions(session) -> set[int]:
    """The journals that took assets out of the books, for the cash flow statement."""
    if not raw(session, "SELECT to_regclass('accounting.fixed_asset') IS NOT NULL").scalar():
        return set()
    return {r.disposal_transaction_id for r in raw(session, 'SELECT disposal_transaction_id FROM accounting.fixed_asset WHERE business_id=%s AND disposal_transaction_id IS NOT NULL',
                                                   (str(session.business_id),)).all()}


def brought_in(session) -> set[int]:
    """Transactions that bring in assets owned before the books started: positions brought in, not activity."""
    if not raw(session, "SELECT to_regclass('accounting.fixed_asset') IS NOT NULL").scalar():
        return set()
    return {r.transaction_id for r in raw(session, "SELECT transaction_id FROM accounting.fixed_asset WHERE business_id=%s AND how='existing'",
                                          (str(session.business_id),)).all()}
