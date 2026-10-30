"""Turn on a business's books from its approved opening position (Doc 09 section 8 step 7, FR-130, RB-05).

Privileged and explicit: run through tools/activate_books.py on a connection that may create library rows and
read onboarding_private. In one transaction it checks the approved opening position still matches the business,
provisions the adopted chart, posts the opening journal exactly as approved, proves the ledger equals that
journal, and only then marks the business active with the start date as its cutover. Any failure rolls back all of it.
"""
import json
from collections import defaultdict
from datetime import date
from decimal import Decimal
from uuid import UUID, uuid4
from python_accounting.models import Account
from python_accounting.transactions import JournalEntry
from cacu.accounting.chart import build_mapping
from cacu.accounting.posting import native_post
from cacu.accounting.provisioning import provision
from cacu.accounting.session import AtomicAccountingSession

SOURCE_TYPE = 'opening_balance'
# Legacy records dated after the start date would be missing from the new books (RB-05 reconciliation).
LEGACY_DATED = {'financial_transactions': "(to_jsonb(t)->>'date')::date",
                'journal_entries': "(to_jsonb(t)->>'entry_date')::date",
                'invoices': "CASE WHEN t.status <> 'draft' THEN (to_jsonb(t)->>'issue_date')::date END",
                'transactions': "timezone(%(tz)s, (to_jsonb(t)->>'created_at')::timestamptz)::date",
                'payments': "CASE WHEN t.status = 'success' THEN timezone(%(tz)s, (to_jsonb(t)->>'created_at')::timestamptz)::date END"}


class ActivationError(ValueError):
    """A reviewed reason the books cannot be turned on; the code is stable for operators and tests."""
    def __init__(self, code, detail=''):
        super().__init__(f'{code}: {detail}' if detail else code)
        self.code = code


class _Driver:
    """build_mapping reads through a DB-API style execute; run it inside this same transaction."""
    def __init__(self, connection):
        self.connection = connection

    def execute(self, sql, args=()):
        return self.connection.exec_driver_sql(sql, args)


def _approved_position(connection, tenant):
    row = connection.exec_driver_sql("""SELECT version, status, as_of, summary, journal, request_key, approved_by, approved_at
        FROM onboarding_private.opening_positions WHERE business_id=%s AND status IN ('draft','approved') FOR UPDATE""", (tenant,)).first()
    if not row or row.status != 'approved':
        raise ActivationError('OPENING_POSITION_NOT_APPROVED', 'an Owner or Admin must approve the opening position first')
    return row


def _legacy_after(connection, tenant, as_of, timezone):
    found = {}
    for table, day in LEGACY_DATED.items():
        if not connection.exec_driver_sql("SELECT to_regclass(%s)", (f'public.{table}',)).scalar():
            continue
        sql = f'SELECT count(*) FROM public.{table} t WHERE t.business_id=%(b)s AND {day} > %(d)s'
        count = connection.exec_driver_sql(sql, {'b': tenant, 'd': as_of, 'tz': timezone}).scalar()
        if count:
            found[table] = count
    return found


def _check_unchanged(connection, tenant, position):
    stock = connection.exec_driver_sql('SELECT onboarding_private.stock_value(%s)', (tenant,)).scalar()
    if Decimal(stock) != Decimal(position.summary['stock']):
        raise ActivationError('STOCK_CHANGED', f"approved {position.summary['stock']}, catalogue now {stock}; review and approve again")
    debit = credit = Decimal('0')
    for line in position.journal['lines']:
        amount = Decimal(line['amount'])
        if amount <= 0 or line['side'] not in {'debit', 'credit'}:
            raise ActivationError('OPENING_JOURNAL_INVALID')
        debit, credit = (debit + amount, credit) if line['side'] == 'debit' else (debit, credit + amount)
        if line.get('party_type'):
            if line['party_type'] not in {'customers', 'suppliers'} or not connection.exec_driver_sql(
                    f"SELECT 1 FROM public.{line['party_type']} WHERE id=%s AND business_id=%s", (line['party_id'], tenant)).first():
                raise ActivationError('PARTY_REMOVED', 'a customer or supplier in the approved position no longer exists')
    if debit != credit or debit != Decimal(position.summary['owns']):
        raise ActivationError('OPENING_JOURNAL_UNBALANCED')
    return debit


def _party_names(connection, tenant, lines):
    names = {}
    for line in lines:
        if line.get('party_type'):
            names[line['party_id']] = connection.exec_driver_sql(
                f"SELECT name FROM public.{line['party_type']} WHERE id=%s AND business_id=%s", (line['party_id'], tenant)).scalar()
    return names


def _ledger_matches(connection, tenant, expected):
    """Every ledger leg of the business, by source account, equals the approved journal (3900 nets to zero)."""
    rows = connection.exec_driver_sql("""SELECT m.account_id, sum(CASE WHEN l.entry_type::text='DEBIT' THEN l.amount ELSE -l.amount END)
        FROM accounting.ledger l JOIN accounting.account_map m ON m.library_id=l.post_account_id AND m.business_id=l.business_id
        WHERE l.business_id=%s GROUP BY m.account_id""", (tenant,)).all()
    actual = {str(account): Decimal(total) for account, total in rows if Decimal(total) != 0}
    return actual == {k: v for k, v in expected.items() if v != 0}


def _opening_document(connection, session, tenant, accounts, line, name, as_of, number):
    """One clearable opening entry per customer or supplier balance, so receipts and payments can be matched to it.
    Customers also get an opening invoice (OPEN-000001) that the invoice list and receipt flow already understand."""
    customer = line['party_type'] == 'customers'
    amount = Decimal(line['amount'])
    party_account, clearing = accounts
    tx = native_post(session, JournalEntry, party_account, [(clearing, amount, customer, f'Opening balance: {name}')], as_of,
                     f'Opening balance: {name}', not customer)
    source = uuid4()
    if customer:
        connection.exec_driver_sql("""INSERT INTO public.invoices(id,business_id,customer_id,invoice_number,type,status,issue_date,due_date,subtotal,total,tax,vat_included,notes)
            VALUES(%s,%s,%s,%s,'Invoice','sent',%s,%s,%s,%s,0,false,%s)""",
            (str(source), tenant, line['party_id'], f'OPEN-{number:06d}', as_of, as_of, amount, amount, f'Opening balance owed on {as_of.isoformat()}'))
    kind = 'invoice' if customer else 'bill'
    connection.exec_driver_sql('INSERT INTO accounting.document_map(business_id,source_type,source_id,transaction_id) VALUES(%s,%s,%s,%s)',
                               (tenant, kind, str(source), tx.id))
    return {'type': kind, 'source_id': str(source), 'party_id': line['party_id'], 'amount': format(amount, '.2f'),
            'transaction_id': tx.id, 'number': f'OPEN-{number:06d}' if customer else None}


def _main_and_rest(lines):
    """The library refuses a main account that is also a line account. Prefer an account used once; otherwise
    the first account's lines (several customers or suppliers) become one combined main amount."""
    counts = defaultdict(int)
    for line in lines:
        counts[line['account_id']] += 1
    main = next((line['account_id'] for line in lines if counts[line['account_id']] == 1), lines[0]['account_id'])
    return main, [line for line in lines if line['account_id'] != main]


def activate(connection, business_id: UUID, operator: UUID, allow_unreviewed=False, today: date | None = None):
    """Post the approved opening journal and mark the business active. Returns the reconciliation evidence."""
    tenant = str(business_id)
    connection.exec_driver_sql("SELECT set_config('cacu.business_id',%s,true),set_config('search_path','accounting,public,pg_catalog',true)", (tenant,))
    connection.exec_driver_sql('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))', (tenant,))
    if not connection.exec_driver_sql('SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user').scalar():
        raise ActivationError('PRIVILEGED_CONNECTION_REQUIRED')
    if connection.exec_driver_sql('SELECT 1 FROM accounting.business_map WHERE business_id=%s', (tenant,)).first():
        raise ActivationError('BOOKS_ALREADY_SET_UP', 'this business already has an accounting entity; review it instead')
    member = connection.exec_driver_sql("SELECT role::text FROM public.memberships WHERE business_id=%s AND user_id=%s AND coalesce((to_jsonb(memberships)->>'is_active')::boolean, true)",
                                        (tenant, str(operator))).scalar()
    if member not in {'owner', 'admin'}:
        raise ActivationError('OPERATOR_NOT_AUTHORISED', 'the requesting user must be an Owner or Admin of the business')
    position = _approved_position(connection, tenant)
    timezone = 'Africa/Lagos'
    today = today or connection.exec_driver_sql('SELECT timezone(%s, now())::date', (timezone,)).scalar()
    if position.as_of > today or position.as_of.year != today.year:
        raise ActivationError('START_DATE_OUTSIDE_CURRENT_YEAR', f'start date {position.as_of} must be in {today.year}; choose a new start date and approve again')
    total = _check_unchanged(connection, tenant, position)
    legacy = _legacy_after(connection, tenant, position.as_of, timezone)
    if legacy:
        raise ActivationError('LEGACY_ACTIVITY_AFTER_START_DATE', f'{legacy}; choose a later start date so no records are left out')
    try:
        mapping = build_mapping(_Driver(connection), business_id, allow_unreviewed=allow_unreviewed)
    except ValueError as error:
        raise ActivationError('CHART_NOT_READY', str(error)) from error

    session = AtomicAccountingSession(bind=connection, info={'ignore_isolation': False, 'include_deleted': False})
    try:
        entity, library = provision(connection, session, business_id, mapping)
        session.entity = entity
        transaction_id = transaction_no = None
        documents = []
        lines = position.journal['lines']
        expected = defaultdict(Decimal)
        for line in lines:
            expected[line['account_id']] += Decimal(line['amount']) * (1 if line['side'] == 'debit' else -1)
        if any(line['account_id'] not in library for line in lines):
            raise ActivationError('OPENING_ACCOUNT_UNMAPPED', 'the approved journal uses an account outside the adopted chart')
        # Party balances post as their own clearable entries against opening balance equity (3900); the main
        # journal takes 3900 in their place, so 3900 nets to zero and every account still equals the approval.
        party_lines = [line for line in lines if line.get('party_id')]
        main_lines = [line for line in lines if not line.get('party_id')]
        clearing = str(connection.exec_driver_sql("SELECT id FROM public.accounts WHERE business_id=%s AND code='3900' AND is_active", (tenant,)).scalar())
        if party_lines and clearing not in library:
            raise ActivationError('OPENING_ACCOUNT_UNMAPPED', 'opening balance equity (3900) is needed for customer and supplier balances')
        net = sum((Decimal(l['amount']) * (1 if l['side'] == 'debit' else -1) for l in party_lines), Decimal('0'))
        if net:
            main_lines.append({'account_id': clearing, 'side': 'debit' if net > 0 else 'credit', 'amount': str(abs(net))})
        if main_lines:
            signed = defaultdict(Decimal)
            for line in main_lines:
                signed[line['account_id']] += Decimal(line['amount']) * (1 if line['side'] == 'debit' else -1)
            main, rest = _main_and_rest(main_lines)
            legs = [(session.get(Account, library[line['account_id']]), Decimal(line['amount']), line['side'] == 'credit', 'Opening balance') for line in rest]
            tx = native_post(session, JournalEntry, session.get(Account, library[main]), legs, position.as_of,
                             f'Opening balances (version {position.version})', signed[main] < 0, abs(signed[main]))
            transaction_id, transaction_no = tx.id, tx.transaction_no
            connection.exec_driver_sql('INSERT INTO accounting.document_map(business_id,source_type,source_id,transaction_id) VALUES(%s,%s,%s,%s)',
                                       (tenant, SOURCE_TYPE, str(position.request_key), transaction_id))
        names = _party_names(connection, tenant, party_lines)
        customers = 0
        for line in party_lines:
            customers += line['party_type'] == 'customers'
            documents.append(_opening_document(connection, session, tenant,
                (session.get(Account, library[line['account_id']]), session.get(Account, library[clearing])),
                line, names[line['party_id']], position.as_of, customers))
        if not _ledger_matches(connection, tenant, expected):
            raise ActivationError('LEDGER_MISMATCH', 'posted ledger does not equal the approved opening journal')
        evidence = {'opening_version': position.version, 'start_date': position.as_of.isoformat(), 'template': mapping['template'],
                    'approved_by': str(position.approved_by), 'approved_at': position.approved_at.isoformat(),
                    'activated_by': str(operator), 'debits': format(total, '.2f'), 'credits': format(total, '.2f'),
                    'stock_value': position.summary['stock'], 'owner_equity': position.summary['owner_equity'],
                    'transaction_id': transaction_id, 'transaction_no': transaction_no, 'accounts': len(mapping['accounts']),
                    'parties': len(mapping['parties']), 'opening_documents': documents, 'legacy_after_start_date': legacy,
                    'template_reviewed': mapping['template_status'] == 'reviewed'}
        connection.exec_driver_sql("""INSERT INTO accounting.business_map(business_id,entity_id,timezone,state,cutover_date,reconciliation_evidence)
            VALUES(%s,%s,%s,'active',%s,%s::jsonb)""", (tenant, entity.id, timezone, position.as_of, json.dumps(evidence)))
        connection.exec_driver_sql('INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,%s,%s::jsonb)',
                                   (tenant, str(operator), str(position.request_key), 'books_activated', json.dumps(evidence)))
        connection.exec_driver_sql("""INSERT INTO public.audit_logs(business_id,user_id,action,table_name,record_id,details)
            VALUES(%s,%s,'BOOKS_ACTIVATED','business_map',%s,%s::jsonb)""", (tenant, str(operator), tenant, json.dumps(evidence)))
        session.flush()
        # Fire the deferred balanced-ledger checks now, so a dry run proves them before rolling back.
        connection.exec_driver_sql('SET CONSTRAINTS ALL IMMEDIATE')
    finally:
        session.close()
    return evidence
