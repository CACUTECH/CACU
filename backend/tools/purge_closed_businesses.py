"""Closed-business removal (Doc 10 E22 part 3, FR-210): 90 days after a business closed, remove its customers' and
suppliers' contact details and its operational data; the books stay, read-only. Run daily by the scheduler."""
import argparse
import json
from cacu.billing.service import platform_transaction


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true', help='Remove what is due (otherwise only count closures past 90 days)')
    parser.add_argument('--json', action='store_true', help='Emit counts and status only, never business data')
    args = parser.parse_args(argv)
    report = {'mode': 'apply' if args.apply else 'dry-run', 'status': 'ok'}
    code = 0
    try:
        with platform_transaction() as cursor:
            cursor.execute('SELECT platform.closures_due()')
            report['due'] = cursor.fetchone()[0]
            if args.apply:
                cursor.execute("SELECT set_config('statement_timeout', '300000', true)")
                cursor.execute('SELECT platform.purge_closed_businesses()')
                report['removed'] = cursor.fetchone()[0]
    except Exception:
        # Failure must be visible to the scheduler; never print business data.
        report['status'] = 'error'
        code = 1
    print(json.dumps(report) if args.json else report)
    return code


if __name__ == '__main__':
    raise SystemExit(main())
