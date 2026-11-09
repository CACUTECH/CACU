"""Online payments operator (Doc 10 E23; Doc 09 PR-14, PR-15): for every business that connected Paystack, verify
checkouts still waiting and match Paystack payouts to the bank. Run every 30 minutes by the scheduler."""
import argparse
import json
from cacu.billing.service import platform_transaction
from cacu.payments.service import check_all


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true', help='Verify, post and match (otherwise only count connected businesses)')
    parser.add_argument('--json', action='store_true', help='Emit counts and status only, never keys, customer or provider details')
    args = parser.parse_args(argv)
    report = {'mode': 'apply' if args.apply else 'dry-run', 'status': 'ok'}
    code = 0
    try:
        if args.apply:
            report.update(check_all())
        else:
            with platform_transaction() as cursor:
                cursor.execute('SELECT accounting.payment_businesses()')
                report['businesses'] = len(cursor.fetchone()[0] or [])
    except Exception:
        # Failure must be visible to the scheduler; never print provider bodies or keys.
        report['status'] = 'error'
        code = 1
    print(json.dumps(report) if args.json else report)
    return code


if __name__ == '__main__':
    raise SystemExit(main())
