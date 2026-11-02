"""Renewal operator (Doc 14 SUB-04, SUB-08): charge saved cards whose renewal is due. Run hourly by the scheduler."""
import argparse
import json
from cacu.billing.service import platform_transaction, call, renew_due


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true', help='Charge the saved cards that are due (otherwise only count them)')
    parser.add_argument('--json', action='store_true', help='Emit counts and status only, never card, customer or provider details')
    args = parser.parse_args(argv)
    report = {'mode': 'apply' if args.apply else 'dry-run', 'status': 'ok'}
    code = 0
    try:
        if args.apply:
            report.update(renew_due())
        else:
            with platform_transaction() as cursor:
                report['due'] = len(call(cursor, 'SELECT platform.due_card_charges()', ()))
    except Exception:
        # Failure must be visible to the scheduler; never print provider bodies or credentials.
        report['status'] = 'error'
        code = 1
    print(json.dumps(report) if args.json else report)
    return code


if __name__ == '__main__':
    raise SystemExit(main())
