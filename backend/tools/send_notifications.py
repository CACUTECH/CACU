"""Notification operator (Doc 14 SUB-04, SUB-08, SUB-09): send queued billing reminders. Run hourly by the scheduler."""
import argparse
import json
from cacu.billing.notify import configured_channels, send_due


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true', help='Send the queued reminders (otherwise only report the configured channels)')
    parser.add_argument('--json', action='store_true', help='Emit counts and status only, never addresses, numbers or message text')
    args = parser.parse_args(argv)
    report = {'mode': 'apply' if args.apply else 'dry-run', 'status': 'ok'}
    code = 0
    try:
        report.update(send_due() if args.apply else {'channels': configured_channels()})
        if report.get('failed'):
            report['status'] = 'retry_required'
            code = 1
    except Exception:
        # Failure must be visible to the scheduler; never print provider bodies, keys or recipients.
        report['status'] = 'error'
        code = 1
    print(json.dumps(report) if args.json else report)
    return code


if __name__ == '__main__':
    raise SystemExit(main())
