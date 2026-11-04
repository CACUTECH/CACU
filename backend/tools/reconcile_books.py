"""Reconciliation operator (Doc 09 §6, TEST-402): check every activated business's books. Run daily by the scheduler.
Exits 1 when any business's books disagree or could not be checked, so the scheduler shows it."""
import argparse
import json
from uuid import UUID
from cacu.accounting.reconcile import reconcile_all
from cacu.billing.service import call, platform_transaction


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true', help='Check every activated business and record the results (otherwise only count them)')
    parser.add_argument('--json', action='store_true', help='Emit counts and status only, never business names or figures')
    parser.add_argument('--business', type=UUID, help='Check only this activated business, for example right after activation')
    args = parser.parse_args(argv)
    report = {'mode': 'apply' if args.apply else 'dry-run', 'status': 'ok'}
    code = 0
    try:
        if args.apply:
            report.update(reconcile_all(args.business))
            if report['exceptions'] or report['failed']:
                report['status'] = 'attention_required'
                code = 1
        else:
            with platform_transaction() as cursor:
                books = call(cursor, 'SELECT ops.books_to_check()', ())
            report['businesses'] = len([b for b in books if args.business is None or b['business_id'] == str(args.business)])
    except Exception:
        report['status'] = 'error'
        code = 1
    print(json.dumps(report) if args.json else report)
    return code


if __name__ == '__main__':
    raise SystemExit(main())
