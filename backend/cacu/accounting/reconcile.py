"""Daily reconciliation of every business on the native ledger (Doc 09 §6, Doc 19 TEST-402).

For each activated business: the trial balance must balance; customer balances, supplier balances and stock must equal
their control accounts (the ACC-013 checks in trial_balance); and closing cash in this month's cash-flow statement must
equal the ledger. The check reads as the business's first active owner and writes nothing to the books; results go to
ops.reconciliation_runs and differences queue an owner reminder. Reports carry counts only."""
import json
import logging
from uuid import UUID
from fastapi import HTTPException
from cacu.accounting.posting import raw
from cacu.accounting.reports import cash_flow, trial_balance
from cacu.accounting.session import library_transaction
from cacu.accounting.workflows import business_today
from cacu.billing.service import call, platform_transaction

log = logging.getLogger(__name__)


def check_books(session):
    """(as_of, exceptions) for one business, from the same reports owners see."""
    today = business_today(session)
    exceptions = list(trial_balance(session, today)['exceptions'])
    cutover = raw(session, 'SELECT cutover_date FROM accounting.business_map WHERE business_id=%s', (str(session.business_id),)).scalar()
    start = max(cutover, today.replace(day=1)) if cutover else today.replace(day=1)
    if start <= today:
        try:
            flow = cash_flow(session, start, today)
            if not flow['reconciled']:
                exceptions.append({'check': 'cash', 'message': 'Closing cash in the cash-flow statement differs from the ledger',
                                   'difference': flow['difference']})
        except HTTPException as exc:  # the report refuses books that do not reconcile; that is itself the finding
            exceptions.append({'check': 'cash', 'message': str(exc.detail)})
    return today, exceptions


def reconcile_all(only: str | None = None) -> dict:
    """Check every activated business, or only the one given (for example straight after activation, RB-05)."""
    with platform_transaction() as cursor:
        books = call(cursor, 'SELECT ops.books_to_check()', ())
    if only is not None:
        books = [book for book in books if book['business_id'] == str(only)]
    report = {'checked': 0, 'clean': 0, 'exceptions': 0, 'failed': 0}
    for book in books:
        try:
            with library_transaction(UUID(book['actor']), UUID(book['business_id'])) as session:
                as_of, problems = check_books(session)
        except Exception:  # one business's failure must not stop the others, and must be visible
            log.exception('Reconciliation could not run for business %s', book['business_id'])
            report['failed'] += 1
            continue
        with platform_transaction() as cursor:
            cursor.execute('SELECT ops.record_reconciliation(%s,%s,%s)', (book['business_id'], as_of, json.dumps(problems)))
        report['checked'] += 1
        report['clean' if not problems else 'exceptions'] += 1
    return report
