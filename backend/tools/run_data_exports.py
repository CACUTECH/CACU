"""Data export operator (Doc 10 E22 part 2, FR-192, NFR-035): builds waiting exports, fails ones that stopped part way,
and deletes files after seven days. Run every 10 minutes by the scheduler, so an export is ready within the hour."""
import argparse
import json
from cacu.accounting.exports import run_queue


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true', help='Build, fail and delete (otherwise only count waiting exports)')
    parser.add_argument('--json', action='store_true', help='Emit counts and status only, never business data')
    args = parser.parse_args(argv)
    report = {'mode': 'apply' if args.apply else 'dry-run', 'status': 'ok'}
    code = 0
    try:
        report.update(run_queue(apply=args.apply))
    except Exception:
        # Failure must be visible to the scheduler; never print business data.
        report['status'] = 'error'
        code = 1
    print(json.dumps(report) if args.json else report)
    return code


if __name__ == '__main__':
    raise SystemExit(main())
