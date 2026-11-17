"""VAT (Doc 09 PR-32; Doc 10 E14 R3 part 2a). Owner decisions of 17 November 2026: VAT is off unless the business
says it is VAT-registered, from a date it gives. Then 7.5% standard, each item standard, zero-rated or exempt; till
prices include VAT; each invoice says whether its prices include VAT.

VAT is worked out per document and rounded to the kobo (half up), so the ledger, the invoice and the VAT return agree
exactly. A taxed sale or invoice posts as one balanced entry: the till, bank or receivable with the gross amount,
revenue with the net, and Output VAT payable (2200) with the VAT. Each taxed document also leaves a row in
accounting.document_vat, which the VAT return adds up and checks against the ledger.
"""
import json
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5
from fastapi import HTTPException
from pydantic import BaseModel, Field
from cacu.accounting.posting import raw

CENT = Decimal('0.01')
ZERO = Decimal('0')
CLASSES = ('standard', 'zero_rated', 'exempt')
ACCOUNTS = {'vat_output': 'Output VAT payable', 'vat_input': 'Input VAT recoverable', 'wht_receivable': 'Withholding tax credits'}
TAXED_LATER = 'Refunds and credit notes for documents with VAT are not available yet. Record a new adjusting document instead.'


class VatSettings(BaseModel):
    registered: bool
    vat_number: str | None = Field(default=None, pattern=r'^[0-9A-Za-z-]{6,20}$')
    effective_from: date | None = None
    invoices_include_vat: bool = False


class ItemClass(BaseModel):
    item_id: UUID
    vat_class: Literal['standard', 'zero_rated', 'exempt']


class ItemClasses(BaseModel):
    items: list[ItemClass] = Field(min_length=1, max_length=500)


@dataclass
class Split:
    """One document's amounts by VAT class, after VAT."""
    standard_net: Decimal = ZERO
    zero_rated_net: Decimal = ZERO
    exempt_net: Decimal = ZERO
    vat: Decimal = ZERO
    rate: Decimal = ZERO

    @property
    def net(self):
        return self.standard_net + self.zero_rated_net + self.exempt_net

    @property
    def gross(self):
        return self.net + self.vat


def setting(session):
    return raw(session, 'SELECT * FROM accounting.vat_setting WHERE business_id=%s', (str(session.business_id),)).first()


def charging(session, day: date) -> bool:
    """Whether the business charges VAT on a document dated day."""
    row = setting(session)
    return bool(row and row.registered and row.effective_from and day >= row.effective_from)


def rate(session, vat_class: str, day: date) -> Decimal:
    value = raw(session, 'SELECT rate FROM accounting.vat_rate WHERE vat_class=%s AND effective_from<=%s ORDER BY effective_from DESC LIMIT 1',
                (vat_class, day)).scalar()
    if value is None:
        raise HTTPException(409, 'No VAT rate applies on that date.')
    return Decimal(value)


def classes(session, item_ids) -> dict:
    ids = [str(i) for i in item_ids]
    rows = raw(session, 'SELECT item_id::text, vat_class FROM accounting.item_vat_class WHERE business_id=%s AND item_id=ANY(%s::uuid[])',
               (str(session.business_id), ids)).all() if ids else []
    found = {r.item_id: r.vat_class for r in rows}
    return {i: found.get(i, 'standard') for i in ids}


def split(session, day: date, values, inclusive: bool) -> Split:
    """values: [(item_id, amount)]. inclusive: the amounts already include VAT (till prices). VAT is charged only when
    the business is registered on that day; otherwise everything is outside VAT and nothing is added."""
    result = Split()
    if not charging(session, day):
        result.exempt_net = sum((Decimal(a) for _, a in values), ZERO)
        return result
    by_class = classes(session, [i for i, _ in values])
    totals = {c: ZERO for c in CLASSES}
    for item_id, amount in values:
        totals[by_class[str(item_id)]] += Decimal(amount)
    result.rate = rate(session, 'standard', day)
    standard = totals['standard']
    if inclusive:
        result.vat = (standard * result.rate / (100 + result.rate)).quantize(CENT, rounding=ROUND_HALF_UP)
        result.standard_net = standard - result.vat
    else:
        result.vat = (standard * result.rate / 100).quantize(CENT, rounding=ROUND_HALF_UP)
        result.standard_net = standard
    result.zero_rated_net, result.exempt_net = totals['zero_rated'], totals['exempt']
    return result


def account(session, purpose: str):
    rows = raw(session, 'SELECT account_id FROM accounting.account_map WHERE business_id=%s AND purpose=%s',
               (str(session.business_id), purpose)).all()
    return rows[0].account_id if len(rows) == 1 else None


def output_lines(session, revenue, figures: Split, credited: bool):
    """The posting lines for a sale or invoice: revenue with the net, and Output VAT payable with any VAT."""
    lines = [{'account_id': revenue, 'amount': format(figures.net, '.2f'), 'credited': credited}]
    if figures.vat > 0:
        vat_account = account(session, 'vat_output')
        if vat_account is None:
            raise HTTPException(409, 'Turn VAT on again in Settings › Taxes to add the VAT accounts.')
        lines.append({'account_id': vat_account, 'amount': format(figures.vat, '.2f'), 'credited': credited})
    return lines


def record(session, source_type: str, source_id, direction: str, day: date, figures: Split):
    """What the document charged, for the VAT return. Only documents with VAT, zero-rated or exempt supplies while
    registered are recorded; a business that is not registered leaves nothing."""
    if not charging(session, day):
        return
    raw(session, """INSERT INTO accounting.document_vat(business_id,source_type,source_id,direction,entry_date,standard_net,zero_rated_net,exempt_net,vat,rate)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""", (str(session.business_id), source_type, str(source_id), direction, day,
                                                  figures.standard_net, figures.zero_rated_net, figures.exempt_net, figures.vat, figures.rate))


def refuse_if_taxed(session, source_type: str, source_id):
    """Refunds and credit notes take VAT back only from part 2c; until then a document that carried VAT is refused."""
    vat = raw(session, 'SELECT vat FROM accounting.document_vat WHERE business_id=%s AND source_type=%s AND source_id=%s',
              (str(session.business_id), source_type, str(source_id))).scalar()
    if vat and Decimal(vat) > 0:
        raise HTTPException(409, TAXED_LATER)


def ensure_accounts(session, actor):
    from cacu.accounting.accounts import add_account
    tenant = str(session.business_id)
    for purpose, name in ACCOUNTS.items():
        if account(session, purpose) is None:
            add_account(session, actor, uuid5(NAMESPACE_URL, f'cacu:{purpose}:{tenant}'), purpose, name)


def overview(session):
    row = setting(session)
    items = raw(session, """SELECT c.id::text AS id, c.name, coalesce(v.vat_class,'standard') AS vat_class
        FROM public.catalog_items c LEFT JOIN accounting.item_vat_class v ON v.business_id=c.business_id AND v.item_id=c.id
        WHERE c.business_id=%s AND c.is_active ORDER BY c.name LIMIT 500""", (str(session.business_id),)).mappings().all()
    return {'registered': bool(row and row.registered), 'vat_number': row.vat_number if row else None,
            'effective_from': row.effective_from.isoformat() if row and row.effective_from else None,
            'invoices_include_vat': bool(row and row.invoices_include_vat),
            'standard_rate': format(rate(session, 'standard', date.today()), 'f'),
            'items': [dict(i) for i in items]}


def save_settings(session, actor, data: VatSettings):
    from cacu.accounting.periods import month_closed
    from cacu.accounting.workflows import role
    if role(session, actor) not in {'owner', 'admin'}:
        raise HTTPException(403, 'Only the business owner or an Admin can change tax settings.')
    if data.registered:
        if not data.vat_number or data.effective_from is None:
            raise HTTPException(422, 'Enter the VAT number and the date you started charging VAT.')
        cutover = raw(session, 'SELECT cutover_date FROM accounting.business_map WHERE business_id=%s', (str(session.business_id),)).scalar()
        if cutover and data.effective_from < cutover:
            raise HTTPException(409, 'VAT can start only on or after the day your books started.')
        if month_closed(session, data.effective_from):
            raise HTTPException(409, 'That date is in a closed month. Choose a date in an open month.')
        ensure_accounts(session, actor)
    raw(session, """INSERT INTO accounting.vat_setting(business_id,registered,vat_number,effective_from,invoices_include_vat,updated_by)
        VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT (business_id) DO UPDATE SET registered=EXCLUDED.registered,
         vat_number=coalesce(EXCLUDED.vat_number,accounting.vat_setting.vat_number),
         effective_from=coalesce(EXCLUDED.effective_from,accounting.vat_setting.effective_from),
         invoices_include_vat=EXCLUDED.invoices_include_vat,updated_by=EXCLUDED.updated_by,updated_at=now()""",
        (str(session.business_id), data.registered, data.vat_number, data.effective_from, data.invoices_include_vat, str(actor)))
    raw(session, 'INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,%s,%s::jsonb)',
        (str(session.business_id), str(actor), str(uuid4()), 'vat_settings', json.dumps(data.model_dump(mode='json'))))
    return overview(session)


def save_classes(session, actor, data: ItemClasses):
    ids = [str(i.item_id) for i in data.items]
    known = {r[0] for r in raw(session, 'SELECT id::text FROM public.catalog_items WHERE business_id=%s AND id=ANY(%s::uuid[])',
                               (str(session.business_id), ids)).all()}
    if known != set(ids):
        raise HTTPException(422, 'An item is not in this business.')
    for item in data.items:
        raw(session, """INSERT INTO accounting.item_vat_class(business_id,item_id,vat_class,updated_by) VALUES(%s,%s,%s,%s)
            ON CONFLICT (business_id,item_id) DO UPDATE SET vat_class=EXCLUDED.vat_class,updated_by=EXCLUDED.updated_by,updated_at=now()""",
            (str(session.business_id), str(item.item_id), item.vat_class, str(actor)))
    return overview(session)


def vat_return(session, month: date):
    """The month's VAT return: sales and purchases by VAT class, the VAT on each, what is payable, and whether the
    VAT accounts in the ledger moved by exactly those amounts."""
    from cacu.accounting.periods import month_end
    end = month_end(month)
    rows = {r.direction: r for r in raw(session, """SELECT direction, sum(standard_net) standard_net, sum(zero_rated_net) zero_rated_net,
        sum(exempt_net) exempt_net, sum(vat) vat, count(*) documents FROM accounting.document_vat
        WHERE business_id=%s AND entry_date BETWEEN %s AND %s GROUP BY direction""", (str(session.business_id), month, end)).all()}

    def side(direction):
        r = rows.get(direction)
        figures = {k: (getattr(r, k) if r else ZERO) or ZERO for k in ('standard_net', 'zero_rated_net', 'exempt_net', 'vat')}
        return {**{k: format(Decimal(v), '.2f') for k, v in figures.items()}, 'documents': r.documents if r else 0}

    def moved(purpose, sign):
        source = account(session, purpose)
        if source is None:
            return ZERO
        value = raw(session, """SELECT coalesce(sum(CASE WHEN l.entry_type::text='CREDIT' THEN l.amount ELSE -l.amount END),0)
            FROM accounting.ledger l JOIN accounting.account_map m ON m.library_id=l.post_account_id AND m.business_id=l.business_id
            WHERE l.business_id=%s AND m.account_id=%s AND l.transaction_date::date BETWEEN %s AND %s""",
                    (str(session.business_id), str(source), month, end)).scalar()
        return Decimal(value) * sign
    output, purchases = side('output'), side('input')
    ledger_output, ledger_input = moved('vat_output', 1), moved('vat_input', -1)
    payable = Decimal(output['vat']) - Decimal(purchases['vat'])
    exceptions = []
    if ledger_output != Decimal(output['vat']):
        exceptions.append(f"Output VAT in the ledger ({ledger_output:.2f}) differs from the documents ({output['vat']}).")
    if ledger_input != Decimal(purchases['vat']):
        exceptions.append(f"Input VAT in the ledger ({ledger_input:.2f}) differs from the documents ({purchases['vat']}).")
    row = setting(session)
    return {'month': month.isoformat(), 'vat_number': row.vat_number if row else None, 'sales': output, 'purchases': purchases,
            'payable': format(payable, '.2f'), 'exceptions': exceptions,
            'note': 'Prepared from CACU records for you to check before filing. CACU does not file VAT returns.'}
