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


class VatSettings(BaseModel):
    registered: bool
    vat_number: str | None = Field(default=None, pattern=r'^[0-9A-Za-z-]{6,20}$')
    effective_from: date | None = None
    invoices_include_vat: bool = False
    wht_enabled: bool = False  # customers deduct withholding tax (2c)


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


def record(session, source_type: str, source_id, direction: str, day: date, figures: Split, base: Decimal, inclusive: bool):
    """What the document charged, for the VAT return. Only documents with VAT, zero-rated or exempt supplies while
    registered are recorded; a business that is not registered leaves nothing. base is the value its lines were priced
    at (gross where prices include VAT, net where VAT is added on top)."""
    if not charging(session, day):
        return
    raw(session, """INSERT INTO accounting.document_vat(business_id,source_type,source_id,direction,entry_date,standard_net,zero_rated_net,exempt_net,vat,rate,base,inclusive)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""", (str(session.business_id), source_type, str(source_id), direction, day,
              figures.standard_net, figures.zero_rated_net, figures.exempt_net, figures.vat, figures.rate, base, inclusive))


@dataclass
class TakenBack:
    """What a refund, credit note or reversal takes back from a document that was recorded for VAT."""
    original: object
    base: Decimal          # the value taken back, on the document's own basis
    figures: Split         # the amounts taken back (positive here; recorded negative)

    @property
    def vat(self):
        return self.figures.vat

    @property
    def amount(self):
        """What changes hands: the value itself where prices included VAT, the value plus VAT where it was added on top."""
        return self.base if self.original.inclusive else self.base + self.figures.vat

    @property
    def net(self):
        return self.figures.net


def _original(session, source_type: str, source_id):
    return raw(session, 'SELECT * FROM accounting.document_vat WHERE business_id=%s AND source_type=%s AND source_id=%s AND original_id IS NULL',
               (str(session.business_id), source_type, str(source_id))).first()


def take_back(session, source_type: str, source_id, value: Decimal, vat: Decimal | None = None) -> TakenBack | None:
    """The share of a recorded document's VAT that goes with value (on the document's own basis). The same share of
    its VAT, rounded to the kobo; the last credit takes exactly what is left, so nothing is left over. vat, when given,
    is a figure worked out earlier (a credit note asked for before it was approved) and is checked, not recomputed.
    None when the document was not recorded for VAT (the business was not registered then)."""
    row = _original(session, source_type, source_id)
    if row is None:
        return None
    taken = raw(session, """SELECT coalesce(-sum(base),0) base, coalesce(-sum(vat),0) vat, coalesce(-sum(standard_net),0) standard_net,
        coalesce(-sum(zero_rated_net),0) zero_rated_net, coalesce(-sum(exempt_net),0) exempt_net FROM accounting.document_vat
        WHERE business_id=%s AND original_type=%s AND original_id=%s""", (str(session.business_id), source_type, str(source_id))).one()
    left_base, left_vat = row.base - taken.base, row.vat - taken.vat
    if value <= 0 or value > left_base:
        raise HTTPException(409, 'That is more than is left to take back on this document.')
    whole = value == left_base
    if vat is None:
        vat = left_vat if whole else min(left_vat, (row.vat * value / row.base).quantize(CENT, rounding=ROUND_HALF_UP) if row.base else ZERO)
    elif vat < 0 or vat > left_vat or (whole and vat != left_vat):
        raise HTTPException(409, 'The VAT on this document has changed since this was asked for. Ask again.')
    net = value - vat if row.inclusive else value
    # The net taken back by VAT class, in the document's proportions; the last credit takes what is left of each.
    lefts = {k: getattr(row, k) - getattr(taken, k) for k in ('standard_net', 'zero_rated_net', 'exempt_net')}
    figures = Split(rate=row.rate, vat=vat)
    if whole:
        figures.standard_net, figures.zero_rated_net, figures.exempt_net = lefts['standard_net'], lefts['zero_rated_net'], lefts['exempt_net']
    else:
        total_net = row.standard_net + row.zero_rated_net + row.exempt_net
        share = lambda k: (getattr(row, k) * net / total_net).quantize(CENT, rounding=ROUND_HALF_UP) if total_net else ZERO
        figures.zero_rated_net, figures.exempt_net = min(share('zero_rated_net'), lefts['zero_rated_net']), min(share('exempt_net'), lefts['exempt_net'])
        figures.standard_net = net - figures.zero_rated_net - figures.exempt_net
    return TakenBack(original=row, base=value, figures=figures)


def record_back(session, source_type: str, source_id, day: date, back: TakenBack):
    """The refund, credit note or reversal's own row: the same amounts, negative, on the original's side of the return."""
    o, f = back.original, back.figures
    raw(session, """INSERT INTO accounting.document_vat(business_id,source_type,source_id,direction,entry_date,standard_net,zero_rated_net,exempt_net,vat,rate,base,inclusive,original_type,original_id)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""", (str(session.business_id), source_type, str(source_id), o.direction, day,
              -f.standard_net, -f.zero_rated_net, -f.exempt_net, -f.vat, o.rate, -back.base, o.inclusive, o.source_type, str(o.source_id)))


def output_back_line(session, vat: Decimal, description: str):
    """A refund or credit note debits Output VAT payable with the VAT it gives back."""
    vat_account = account(session, 'vat_output')
    if vat_account is None:
        raise HTTPException(409, 'Turn VAT on again in Settings › Taxes to add the VAT accounts.')
    return {'account_id': vat_account, 'amount': format(vat, '.2f'), 'credited': False, 'description': description}


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
            'invoices_include_vat': bool(row and row.invoices_include_vat), 'wht_enabled': bool(row and row.wht_enabled),
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
    if data.wht_enabled:
        ensure_accounts(session, actor)
    raw(session, """INSERT INTO accounting.vat_setting(business_id,registered,vat_number,effective_from,invoices_include_vat,wht_enabled,updated_by)
        VALUES(%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (business_id) DO UPDATE SET registered=EXCLUDED.registered,wht_enabled=EXCLUDED.wht_enabled,
         vat_number=coalesce(EXCLUDED.vat_number,accounting.vat_setting.vat_number),
         effective_from=coalesce(EXCLUDED.effective_from,accounting.vat_setting.effective_from),
         invoices_include_vat=EXCLUDED.invoices_include_vat,updated_by=EXCLUDED.updated_by,updated_at=now()""",
        (str(session.business_id), data.registered, data.vat_number, data.effective_from, data.invoices_include_vat, data.wht_enabled, str(actor)))
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
    wht = raw(session, """SELECT w.id::text, w.entry_date, w.amount, w.certificate, i.invoice_number, c.name AS customer
        FROM accounting.wht_deduction w LEFT JOIN public.invoices i ON i.business_id=w.business_id AND i.id=w.invoice_id
        LEFT JOIN public.customers c ON c.business_id=w.business_id AND c.id=w.customer_id
        WHERE w.business_id=%s AND w.entry_date BETWEEN %s AND %s ORDER BY w.entry_date, w.created_at""", (str(session.business_id), month, end)).all()
    return {'month': month.isoformat(), 'vat_number': row.vat_number if row else None, 'sales': output, 'purchases': purchases,
            'wht': {'total': format(sum((w.amount for w in wht), ZERO), '.2f'), 'reviewed': False,
                    'deductions': [{'id': w.id, 'date': w.entry_date.isoformat(), 'amount': format(w.amount, '.2f'), 'certificate': w.certificate,
                                    'invoice_number': w.invoice_number, 'customer': w.customer} for w in wht]},
            'payable': format(payable, '.2f'), 'exceptions': exceptions,
            'note': 'Prepared from CACU records for you to check before filing. CACU does not file VAT returns.'}


# Input VAT (part 2b): the VAT on a supplier's bill or receipt, as printed on it. Reclaimable only while the business
# is registered; otherwise VAT is part of the cost and the document is entered without it.
NOT_REGISTERED = 'Your business is not registered for VAT on that date, so VAT is part of the cost. Enter the full amount with no VAT.'


def input_vat(session, day: date, base: Decimal, vat: Decimal, inclusive: bool) -> Split:
    """base is the amount before VAT (bills) or the total paid including VAT (expenses). Checks the VAT is no more
    than the standard rate allows (to the kobo) and returns the purchase as the return records it."""
    figures = Split()
    if vat < 0:
        raise HTTPException(422, 'VAT cannot be below zero.')
    if vat > 0 and not charging(session, day):
        raise HTTPException(409, NOT_REGISTERED)
    if not charging(session, day):
        return figures
    figures.rate = rate(session, 'standard', day)
    most = (base * figures.rate / (100 + figures.rate) if inclusive else base * figures.rate / 100).quantize(CENT, rounding=ROUND_HALF_UP)
    if vat > most:
        raise HTTPException(422, f"VAT of {vat:.2f} is more than {figures.rate.normalize()}% allows on this amount ({most:.2f}). Check the supplier's bill.")
    net = base - vat if inclusive else base
    if vat > 0:
        figures.standard_net, figures.vat = net, vat
    else:
        figures.exempt_net = net  # bought with no VAT charged (zero-rated, exempt, or from a supplier not registered)
    return figures


def output_vat(session, day: date, base: Decimal, vat: Decimal) -> Split:
    """VAT charged on a sale outside the till and invoices (a fixed asset sold): base is the price before VAT. Charged
    only while registered, and no more than the standard rate allows; none charged is recorded as an exempt supply."""
    figures = Split()
    if vat < 0:
        raise HTTPException(422, 'VAT cannot be below zero.')
    if not charging(session, day):
        if vat > 0:
            raise HTTPException(409, 'Your business is not registered for VAT on that date, so it charges no VAT. Enter the price with no VAT.')
        return figures
    figures.rate = rate(session, 'standard', day)
    most = (base * figures.rate / 100).quantize(CENT, rounding=ROUND_HALF_UP)
    if vat > most:
        raise HTTPException(422, f'VAT of {vat:.2f} is more than {figures.rate.normalize()}% of the price ({most:.2f}).')
    if vat > 0:
        figures.standard_net, figures.vat = base, vat
    else:
        figures.exempt_net = base  # an exempt or zero-rated sale, such as land
    return figures


def input_line(session, vat: Decimal, description: str):
    account_id = account(session, 'vat_input')
    if account_id is None:
        raise HTTPException(409, 'Turn VAT on again in Settings › Taxes to add the VAT accounts.')
    return {'account_id': account_id, 'amount': format(vat, '.2f'), 'credited': False, 'description': description}


def status(session):
    """For any member's forms (expenses, bills): whether VAT applies today, and at what rate."""
    from cacu.accounting.workflows import business_today
    today = business_today(session)
    on, row = charging(session, today), setting(session)
    return {'charging': on, 'standard_rate': format(rate(session, 'standard', today), 'f') if on else None,
            'wht_enabled': bool(row and row.wht_enabled)}


# WHT deducted by customers (part 2c; Doc 09 PR-33, treatment to be confirmed by the accountant reviewer).
WHT_MOST = Decimal('10')  # % of the invoice amount it settles: Nigerian WHT on goods and services is 2% to 10%


class WhtCertificate(BaseModel):
    certificate: str = Field(min_length=1, max_length=60)


def deduct_wht(session, actor, request_key, invoice_id, amount: Decimal, paid: Decimal, day: date, certificate: str | None):
    """The WHT a customer kept back from paying an invoice: posted as its own entry against the invoice, so the
    invoice is settled by the cash and the WHT together."""
    from uuid import uuid5 as _uuid5
    from cacu.accounting.posting import PostingCommand, post_command
    row = setting(session)
    if not (row and row.wht_enabled):
        raise HTTPException(409, 'Turn on "Customers deduct withholding tax" in Settings › Taxes first.')
    if amount <= 0:
        raise HTTPException(422, 'Enter the WHT deducted, above zero.')
    if amount > ((paid + amount) * WHT_MOST / 100).quantize(CENT, rounding=ROUND_HALF_UP):
        raise HTTPException(422, f'WHT is at most {WHT_MOST:f}% of the amount it settles. Check the figure.')
    invoice = raw(session, """SELECT i.customer_id, m.account_id FROM public.invoices i JOIN accounting.document_map d ON d.business_id=i.business_id AND d.source_id=i.id AND d.source_type='invoice'
        JOIN accounting."transaction" t ON t.id=d.transaction_id AND t.business_id=d.business_id JOIN accounting.account_map m ON m.business_id=t.business_id AND m.library_id=t.account_id
        WHERE i.business_id=%s AND i.id=%s""", (str(session.business_id), str(invoice_id))).first()
    if invoice is None:
        raise HTTPException(409, 'Invoice must be issued before payment')
    key = _uuid5(request_key, 'wht')
    posting = post_command(session, actor, PostingCommand(request_key=key, kind='wht_deduction', source_id=key, target_id=invoice_id,
        main_account_id=invoice.account_id, counterparty_id=invoice.customer_id, entry_date=day, credited=True,
        narration='WHT deducted by the customer', lines=[{'account_id': account(session, 'wht_receivable'), 'amount': format(amount, '.2f'), 'credited': False}]),
        internal=True)
    raw(session, """INSERT INTO accounting.wht_deduction(business_id,id,invoice_id,customer_id,amount,entry_date,certificate,created_by)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s)""", (str(session.business_id), str(key), str(invoice_id), str(invoice.customer_id), amount, day,
                                             certificate.strip() if certificate else None, str(actor)))
    return posting


def save_certificate(session, deduction_id, data: WhtCertificate):
    done = raw(session, 'UPDATE accounting.wht_deduction SET certificate=%s WHERE business_id=%s AND id=%s RETURNING id',
               (data.certificate.strip(), str(session.business_id), str(deduction_id))).first()
    if done is None:
        raise HTTPException(404, 'That WHT deduction is not in this business.')
    return {'id': str(deduction_id), 'certificate': data.certificate.strip()}
