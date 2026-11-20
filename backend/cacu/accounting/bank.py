"""Bank reconciliation (Doc 03 FR-134; Doc 09 month-end step 2; Doc 11 R3 /bank/statements, /bank/matches).

Owner decisions of 18 November 2026: any bank's CSV statement, its columns mapped by the owner once and remembered
for the bank account; a line that matches nothing can be recorded on the spot (money out as an expense, money in as
other income), posted and matched together, or marked explained with a note.

A statement line matches one ledger entry whose movement on that bank account is the same amount (money in is a
debit to the bank). CACU suggests entries within seven days of the line's date, and for money in also the transfers
still waiting for confirmation: the statement shows the money arrived, so matching confirms the transfer first.
Lines already imported from an overlapping statement are skipped, as are lines from before the books started.
"""
import csv
import hashlib
import io
import json
import re
from collections import Counter
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Literal
from uuid import UUID, uuid4, uuid5
from fastapi import HTTPException
from pydantic import BaseModel, Field
from cacu.accounting.posting import raw

MAX_BYTES = 2_000_000
MAX_LINES = 5000
WINDOW = timedelta(days=7)
DATE_FORMATS = {
    'DMY': ('%d/%m/%Y', '%d-%m-%Y', '%d.%m.%Y', '%d/%m/%y', '%d-%m-%y', '%d-%b-%Y', '%d %b %Y', '%d-%b-%y', '%d %B %Y', '%Y-%m-%d', '%Y/%m/%d'),
    'MDY': ('%m/%d/%Y', '%m-%d-%Y', '%m/%d/%y', '%b %d, %Y', '%Y-%m-%d'),
    'YMD': ('%Y-%m-%d', '%Y/%m/%d', '%Y%m%d'),
}
CHARGES = 'gateway_fees'  # 6400 Bank and payment charges


class Layout(BaseModel):
    """Column numbers (from 0) in the statement's table. Either amount (money in positive, out negative), or
    money_in and money_out columns."""
    header_row: int = Field(ge=0, le=50)
    date: int = Field(ge=0, le=60)
    description: int = Field(ge=0, le=60)
    amount: int | None = Field(default=None, ge=0, le=60)
    money_in: int | None = Field(default=None, ge=0, le=60)
    money_out: int | None = Field(default=None, ge=0, le=60)
    balance: int | None = Field(default=None, ge=0, le=60)
    date_order: Literal['DMY', 'MDY', 'YMD'] = 'DMY'


class StatementPreview(BaseModel):
    account_id: UUID
    csv: str = Field(min_length=1, max_length=MAX_BYTES)


class StatementImport(BaseModel):
    request_key: UUID
    account_id: UUID
    file_name: str = Field(min_length=1, max_length=200)
    csv: str = Field(min_length=1, max_length=MAX_BYTES)
    layout: Layout


class Match(BaseModel):
    line_id: UUID
    transaction_id: int | None = None
    transfer_id: UUID | None = None


class Explain(BaseModel):
    note: str = Field(min_length=5, max_length=500)


class Record(BaseModel):
    request_key: UUID
    kind: Literal['expense', 'income']
    account_id: UUID | None = None  # an expense or income account; bank charges or other income when left out


def _rows(text: str):
    if len(text.encode('utf-8')) > MAX_BYTES:
        raise HTTPException(413, 'The statement is larger than 2 MB. Export a shorter period.')
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=',;\t|')
    except csv.Error:
        dialect = csv.excel
    return [r for r in csv.reader(io.StringIO(text.lstrip('﻿')), dialect)]


KEYS = {'date': ('trans. date', 'trans date', 'txn date', 'transaction date', 'posting date', 'value date', 'date'),
        'description': ('narration', 'description', 'details', 'remarks', 'particulars', 'transaction details'),
        'money_in': ('credit', 'credit amount', 'money in', 'deposit', 'lodgement', 'inflow', 'cr'),
        'money_out': ('debit', 'money out', 'withdrawal', 'outflow', 'dr'),
        'amount': ('amount', 'transaction amount'), 'balance': ('balance', 'running balance', 'closing balance')}


def _guess(rows):
    """The likeliest header row and columns: Nigerian statements often start with account details above the table."""
    for index, row in enumerate(rows[:30]):
        cells = [c.strip().lower() for c in row]
        found = {}
        for field, words in KEYS.items():
            for i, cell in enumerate(cells):
                if i in found.values():
                    continue
                if any(cell == w or cell.startswith(w + ' ') or cell.startswith(w + '(') for w in words):
                    found[field] = i
                    break
        if 'date' in found and 'description' in found and ({'money_in', 'money_out'} <= found.keys() or 'amount' in found):
            return {'header_row': index, **found, 'date_order': 'DMY'}
    return None


def preview(session, data: StatementPreview):
    _bank(session, data.account_id)
    rows = _rows(data.csv)
    if not rows:
        raise HTTPException(422, 'The file has no rows.')
    saved = raw(session, 'SELECT layout FROM accounting.bank_layout WHERE business_id=%s AND account_id=%s',
                (str(session.business_id), str(data.account_id))).scalar()
    guess = saved or _guess(rows)
    header = guess['header_row'] if guess else 0
    return {'rows': rows[:header + 8], 'layout': guess, 'remembered': saved is not None}


def parse_amount(value: str) -> Decimal:
    text = (value or '').strip().upper().replace('NGN', '').replace('₦', '').replace(',', '').replace(' ', '')
    if not text or text in {'-', '--'}:
        return Decimal('0')
    sign = -1 if (text.startswith('(') and text.endswith(')')) or text.endswith('DR') or text.startswith('-') else 1
    text = text.strip('()').removesuffix('DR').removesuffix('CR').lstrip('+-')
    try:
        return Decimal(text).quantize(Decimal('0.01')) * sign
    except InvalidOperation:
        raise ValueError(value) from None


def parse_date(value: str, order: str) -> date:
    text = re.sub(r'\s+\d{1,2}:\d{2}(:\d{2})?(\s*[AP]M)?$', '', (value or '').strip(), flags=re.I)
    for fmt in DATE_FORMATS[order]:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    raise ValueError(value)


def parse(rows, layout: Layout):
    """The statement's lines as (date, description, amount, balance), skipping blank and summary rows."""
    out = []
    for number, row in enumerate(rows[layout.header_row + 1:], start=layout.header_row + 2):
        def cell(i):
            return row[i].strip() if i is not None and i < len(row) else ''
        if not any(c.strip() for c in row) or not cell(layout.date):
            continue
        try:
            day = parse_date(cell(layout.date), layout.date_order)
        except ValueError:
            if out:  # a closing summary such as "Total" after the lines
                continue
            raise HTTPException(422, f'Row {number}: "{cell(layout.date)}" is not a date in the order you chose.') from None
        try:
            if layout.amount is not None:
                amount = parse_amount(cell(layout.amount))
            else:
                amount = parse_amount(cell(layout.money_in)) - abs(parse_amount(cell(layout.money_out)))
            balance = parse_amount(cell(layout.balance)) if layout.balance is not None and cell(layout.balance) else None
        except ValueError as bad:
            raise HTTPException(422, f'Row {number}: "{bad}" is not an amount.') from None
        if amount != 0:
            out.append((day, cell(layout.description)[:500], amount, balance))
    if len(out) > MAX_LINES:
        raise HTTPException(413, f'The statement has more than {MAX_LINES} lines. Export a shorter period.')
    return out


def _bank(session, account_id):
    from cacu.accounting.workflows import bank_accounts
    if str(account_id) not in {str(a['id']) for a in bank_accounts(session)}:
        raise HTTPException(422, 'Choose one of your bank accounts.')
    row = raw(session, 'SELECT library_id FROM accounting.account_map WHERE business_id=%s AND account_id=%s',
              (str(session.business_id), str(account_id))).scalar()
    return row


def import_statement(session, actor, data: StatementImport):
    from cacu.accounting.workflows import business_today
    if data.layout.amount is None and (data.layout.money_in is None or data.layout.money_out is None):
        raise HTTPException(422, 'Choose the amount column, or both the money in and money out columns.')
    _bank(session, data.account_id)
    tenant = str(session.business_id)
    digest = hashlib.sha256(data.csv.encode('utf-8')).hexdigest()
    earlier = raw(session, 'SELECT id FROM accounting.bank_statement WHERE business_id=%s AND account_id=%s AND sha256=%s',
                  (tenant, str(data.account_id), digest)).scalar()
    if earlier:
        raise HTTPException(409, 'This statement has already been imported.')
    lines = parse(_rows(data.csv), data.layout)
    if not lines:
        raise HTTPException(422, 'No transactions were found. Check the columns you chose.')
    today = business_today(session)
    if any(day > today for day, *_ in lines):
        raise HTTPException(422, 'The statement has dates after today. Check the date order you chose.')
    cutover = raw(session, 'SELECT cutover_date FROM accounting.business_map WHERE business_id=%s', (tenant,)).scalar()
    kept = [l for l in lines if cutover is None or l[0] >= cutover]
    raw(session, """INSERT INTO accounting.bank_statement(business_id,id,account_id,file_name,sha256,lines,first_date,last_date,imported_by)
        VALUES(%s,%s,%s,%s,%s,0,%s,%s,%s)""", (tenant, str(data.request_key), str(data.account_id), data.file_name.strip(), digest,
                                               min(l[0] for l in lines), max(l[0] for l in lines), str(actor)))
    seen, added = Counter(), 0
    for position, (day, description, amount, balance) in enumerate(kept, start=1):
        words = ' '.join(description.lower().split())
        key = f'{day.isoformat()}|{amount}|{words}'
        seen[key] += 1  # the same payment twice on one day stays two lines
        fingerprint = hashlib.sha256(f'{key}|{seen[key]}'.encode()).hexdigest()
        done = raw(session, """INSERT INTO accounting.bank_line(business_id,id,statement_id,account_id,line_date,description,amount,balance,position,fingerprint)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (business_id,account_id,fingerprint) DO NOTHING RETURNING id""",
                   (tenant, str(uuid4()), str(data.request_key), str(data.account_id), day, description or '(no description)', amount, balance, position, fingerprint)).first()
        added += 1 if done else 0
    raw(session, 'UPDATE accounting.bank_statement SET lines=%s, skipped=%s WHERE business_id=%s AND id=%s',
        (added, len(lines) - added, tenant, str(data.request_key)))
    raw(session, """INSERT INTO accounting.bank_layout(business_id,account_id,layout,updated_by) VALUES(%s,%s,%s::jsonb,%s)
        ON CONFLICT (business_id,account_id) DO UPDATE SET layout=EXCLUDED.layout,updated_by=EXCLUDED.updated_by,updated_at=now()""",
        (tenant, str(data.account_id), json.dumps(data.layout.model_dump()), str(actor)))
    raw(session, 'INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,%s,%s::jsonb)',
        (tenant, str(actor), str(data.request_key), 'bank_statement_imported', json.dumps({'account_id': str(data.account_id), 'lines': added,
                                                                                            'skipped': len(lines) - added, 'file': data.file_name.strip()})))
    return {'statement_id': str(data.request_key), 'lines': added, 'already_imported': len(kept) - added, 'before_books': len(lines) - len(kept)}


def _line(session, line_id, lock=True):
    row = raw(session, f"SELECT * FROM accounting.bank_line WHERE business_id=%s AND id=%s{' FOR UPDATE' if lock else ''}",
              (str(session.business_id), str(line_id))).first()
    if row is None:
        raise HTTPException(404, 'That statement line is not in this business.')
    return row


def _movements(session, library_id, start: date, end: date, amount: Decimal | None = None):
    """Ledger entries on the bank account between the dates, with how much each moved it, not yet matched."""
    having = 'HAVING sum(CASE WHEN l.entry_type::text=\'DEBIT\' THEN l.amount ELSE -l.amount END)=%s' if amount is not None else \
             'HAVING sum(CASE WHEN l.entry_type::text=\'DEBIT\' THEN l.amount ELSE -l.amount END)<>0'
    args = [str(session.business_id), library_id, start, end + timedelta(days=1), str(session.business_id)] + ([amount] if amount is not None else [])
    return raw(session, f"""SELECT l.transaction_id, t.transaction_no, t.narration, min(l.transaction_date)::date AS day,
        sum(CASE WHEN l.entry_type::text='DEBIT' THEN l.amount ELSE -l.amount END) AS moved
        FROM accounting.ledger l JOIN accounting."transaction" t ON t.id=l.transaction_id AND t.business_id=l.business_id
        WHERE l.business_id=%s AND l.post_account_id=%s AND l.transaction_date>=%s AND l.transaction_date<%s
          AND NOT EXISTS (SELECT FROM accounting.bank_line b WHERE b.business_id=%s AND b.transaction_id=l.transaction_id AND b.status='matched')
        GROUP BY 1,2,3 {having} ORDER BY 4,1""", tuple(args)).all()


def _suggestions(session, line, library_id):
    entries = [{'kind': 'entry', 'transaction_id': m.transaction_id, 'number': m.transaction_no, 'description': m.narration,
                'date': m.day.isoformat(), 'amount': format(m.moved, '.2f')}
               for m in _movements(session, library_id, line.line_date - WINDOW, line.line_date + WINDOW, line.amount)]
    if line.amount > 0:
        waiting = raw(session, """SELECT id::text, entry_date, amount, source_type FROM accounting.pending_transfer
            WHERE business_id=%s AND status='pending' AND amount=%s AND entry_date BETWEEN %s AND %s
              AND (expected_bank_account_id IS NULL OR expected_bank_account_id=%s) ORDER BY entry_date""",
                      (str(session.business_id), line.amount, line.line_date - timedelta(days=30), line.line_date + timedelta(days=1), str(line.account_id))).all()
        entries += [{'kind': 'transfer', 'transfer_id': w.id, 'description': f'Transfer waiting for confirmation ({w.source_type.replace("_", " ")})',
                     'date': w.entry_date.isoformat(), 'amount': format(w.amount, '.2f')} for w in waiting]
    return entries


def overview(session, account_id: UUID | None, month_value: str | None):
    """The bank accounts; for the chosen one and month, every statement line with suggestions for the unmatched, the
    ledger entries no line matches, and the balances."""
    from cacu.accounting.periods import _month, month_end
    from cacu.accounting.workflows import bank_accounts, business_today
    accounts = [{'id': str(a['id']), 'name': a['name']} for a in bank_accounts(session)]
    if account_id is None:
        if not accounts:
            return {'accounts': [], 'account': None}
        account_id = UUID(accounts[0]['id'])
    library_id = _bank(session, account_id)
    month = _month(month_value) if month_value else business_today(session).replace(day=1)
    end = month_end(month)
    tenant = str(session.business_id)
    lines = raw(session, """SELECT b.*, t.transaction_no FROM accounting.bank_line b
        JOIN accounting.bank_statement s ON s.business_id=b.business_id AND s.id=b.statement_id
        LEFT JOIN accounting."transaction" t ON t.id=b.transaction_id AND t.business_id=b.business_id
        WHERE b.business_id=%s AND b.account_id=%s AND b.line_date BETWEEN %s AND %s ORDER BY b.line_date, s.imported_at, b.position""",
                (tenant, str(account_id), month, end)).all()
    out = [{'id': str(l.id), 'date': l.line_date.isoformat(), 'description': l.description, 'amount': format(l.amount, '.2f'),
            'balance': format(l.balance, '.2f') if l.balance is not None else None, 'status': l.status, 'note': l.note,
            'matched_to': l.transaction_no, 'suggestions': _suggestions(session, l, library_id) if l.status == 'unmatched' else []} for l in lines]
    from cacu.accounting.reports import opening_transactions
    opening = opening_transactions(session)  # the opening balance is where the statement starts, not a movement on it
    unpresented = [{'transaction_id': m.transaction_id, 'number': m.transaction_no, 'description': m.narration, 'date': m.day.isoformat(),
                    'amount': format(m.moved, '.2f')} for m in _movements(session, library_id, month, end) if m.transaction_id not in opening]
    ledger = raw(session, """SELECT coalesce(sum(CASE WHEN entry_type::text='DEBIT' THEN amount ELSE -amount END),0) FROM accounting.ledger
        WHERE business_id=%s AND post_account_id=%s AND transaction_date<%s""", (tenant, library_id, end + timedelta(days=1))).scalar()
    last = next((l for l in reversed(lines) if l.balance is not None), None)
    statements = raw(session, """SELECT id::text, file_name, lines, skipped, first_date, last_date, imported_at FROM accounting.bank_statement
        WHERE business_id=%s AND account_id=%s ORDER BY imported_at DESC LIMIT 10""", (tenant, str(account_id))).mappings().all()
    open_lines = sum(1 for l in out if l['status'] == 'unmatched')
    return {'accounts': accounts, 'account': str(account_id), 'month': month.isoformat(), 'lines': out, 'unpresented': unpresented,
            'statements': [{**dict(s), 'first_date': s['first_date'].isoformat() if s['first_date'] else None,
                            'last_date': s['last_date'].isoformat() if s['last_date'] else None, 'imported_at': s['imported_at'].isoformat()} for s in statements],
            'books_balance': format(Decimal(ledger), '.2f'), 'statement_balance': format(last.balance, '.2f') if last else None,
            'summary': {'lines': len(out), 'unmatched': open_lines, 'unpresented': len(unpresented),
                        'reconciled': bool(out) and open_lines == 0 and not unpresented}}


def _decide(session, actor, line, status, transaction_id=None, note=None):
    raw(session, """UPDATE accounting.bank_line SET status=%s, transaction_id=%s, note=%s, decided_by=%s, decided_at=now()
        WHERE business_id=%s AND id=%s""", (status, transaction_id, note, str(actor), str(session.business_id), str(line.id)))
    raw(session, 'INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,%s,%s::jsonb)',
        (str(session.business_id), str(actor), str(uuid4()), 'bank_line_' + status, json.dumps({'line_id': str(line.id), 'transaction_id': transaction_id, 'note': note})))


def match(session, actor, data: Match):
    line = _line(session, data.line_id)
    if line.status != 'unmatched':
        raise HTTPException(409, 'This line is already matched or explained. Undo that first.')
    library_id = _bank(session, line.account_id)
    if data.transfer_id is not None:
        # The statement shows the transfer arrived: confirm it into this bank account, then match what that posted.
        from cacu.accounting.transfers import TransferConfirm, confirm
        if line.amount <= 0:
            raise HTTPException(422, 'Only money coming in can confirm a transfer.')
        waiting = raw(session, "SELECT amount FROM accounting.pending_transfer WHERE business_id=%s AND id=%s AND status='pending'",
                      (str(session.business_id), str(data.transfer_id))).scalar()
        if waiting is None or Decimal(waiting) != line.amount:
            raise HTTPException(409, 'That transfer is not waiting for this amount.')
        confirm(session, actor, data.transfer_id, TransferConfirm(request_key=uuid5(line.id, 'confirm'), bank_account_id=line.account_id,
                                                                   note='Seen on the bank statement'))
        from cacu.accounting.workflows import business_today
        made = _movements(session, library_id, business_today(session), business_today(session), line.amount)
        if not made:
            raise HTTPException(409, 'The transfer was confirmed, but its entry could not be found. Match it from the list.')
        data = Match(line_id=line.id, transaction_id=made[-1].transaction_id)
    if data.transaction_id is None:
        raise HTTPException(422, 'Choose the entry this line matches.')
    moved = _movements(session, library_id, date(2000, 1, 1), date(2100, 1, 1), line.amount)
    if data.transaction_id not in {m.transaction_id for m in moved}:
        raise HTTPException(409, 'That entry does not move this bank account by the same amount, or is matched already.')
    _decide(session, actor, line, 'matched', data.transaction_id)
    return {'id': str(line.id), 'status': 'matched', 'transaction_id': data.transaction_id}


def explain(session, actor, line_id, data: Explain):
    line = _line(session, line_id)
    if line.status != 'unmatched':
        raise HTTPException(409, 'This line is already matched or explained. Undo that first.')
    _decide(session, actor, line, 'explained', None, data.note.strip())
    return {'id': str(line.id), 'status': 'explained'}


def undo(session, actor, line_id):
    line = _line(session, line_id)
    if line.status == 'unmatched':
        raise HTTPException(409, 'This line is not matched or explained.')
    _decide(session, actor, line, 'unmatched')
    return {'id': str(line.id), 'status': 'unmatched'}


def record(session, actor, line_id, data: Record):
    """Records an unmatched line on the spot and matches it: money out as an expense (bank charges unless another
    expense account is chosen), money in as income (other income unless another income account is chosen)."""
    from cacu.accounting.posting import PostingCommand, post_command
    from cacu.accounting.workflows import ExpenseCreate, expense_accounts, expense_create, purpose
    line = _line(session, line_id)
    if line.status != 'unmatched':
        raise HTTPException(409, 'This line is already matched or explained. Undo that first.')
    _bank(session, line.account_id)
    amount = format(abs(line.amount), '.2f')
    description = (line.description or 'Bank statement line')[:500]
    if data.kind == 'expense':
        if line.amount > 0:
            raise HTTPException(422, 'Money coming in is recorded as income, not an expense.')
        target = data.account_id or raw(session, "SELECT account_id FROM accounting.account_map WHERE business_id=%s AND purpose=%s",
                                        (str(session.business_id), CHARGES)).scalar()
        if target is None or str(target) not in {a['id'] for a in expense_accounts(session)}:
            raise HTTPException(422, 'Choose an expense account from your chart.')
        made = expense_create(session, actor, ExpenseCreate(request_key=data.request_key, expense_account_id=target, amount=amount,
                                                            entry_date=line.line_date, method='Transfer', bank_account_id=line.account_id, description=description))
        posting = made['posting']
    else:
        if line.amount < 0:
            raise HTTPException(422, 'Money going out is recorded as an expense, not income.')
        income = {r.account_id: r.type for r in raw(session, """SELECT m.account_id::text AS account_id, n.account_type::text AS type FROM accounting.account_map m
            JOIN accounting.account n ON n.id=m.library_id AND n.business_id=m.business_id WHERE m.business_id=%s""", (str(session.business_id),)).all()}
        target = str(data.account_id) if data.account_id else raw(session, """SELECT a.id::text FROM public.accounts a WHERE a.business_id=%s AND a.code='4900'""",
                                                                  (str(session.business_id),)).scalar()
        if target is None or not income.get(target, '').endswith('REVENUE'):
            raise HTTPException(422, 'Choose an income account from your chart.')
        posting = post_command(session, actor, PostingCommand(request_key=data.request_key, kind='adjustment', source_id=data.request_key,
            main_account_id=line.account_id, entry_date=line.line_date, credited=False, narration=description,
            lines=[{'account_id': target, 'amount': amount, 'credited': True}]))
    _decide(session, actor, line, 'matched', posting['transaction_id'])
    return {'id': str(line.id), 'status': 'matched', 'transaction_id': posting['transaction_id']}
