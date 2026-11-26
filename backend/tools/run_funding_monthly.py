"""Monthly funding readiness assessment (Doc 15 FR-185, FRA-003; E19 R3 part 2): works out this month's assessment for
each business that qualifies, so owners can see progress. Run daily by the scheduler; a business already assessed
this month is skipped, and one that does not qualify yet is tried again the next day. Nothing is due while CACU's
funding readiness switch is off (gate G5)."""
import argparse
import json
from cacu.accounting.readiness import run_monthly


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true', help='Make the assessments (otherwise only count the businesses due)')
    parser.add_argument('--json', action='store_true', help='Emit counts and status only, never business data')
    args = parser.parse_args(argv)
    report = {'mode': 'apply' if args.apply else 'dry-run', 'status': 'ok'}
    code = 0
    try:
        report.update(run_monthly(apply=args.apply))
    except Exception:
        # Failure must be visible to the scheduler; never print business data.
        report['status'] = 'error'
        code = 1
    if report.get('failed'):
        report['status'] = 'partial'
        code = 1
    print(json.dumps(report) if args.json else report)
    return code


if __name__ == '__main__':
    raise SystemExit(main())
