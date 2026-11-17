"""CACU support staff (Doc 10 E22 part 4, FR-212; Doc 17 runbook RB-09). Adds or removes a person from the list of
CACU support staff who may open a case that a business's Owner has granted. Being on the list gives no access by
itself: each business's Owner grants it for one case and a set time, and support must use two-step sign-in.

    python -m tools.support_staff add --user-id <auth user id> --name "Tolu (CACU support)"
    python -m tools.support_staff remove --user-id <auth user id>
"""
import argparse
import json
from uuid import UUID
from cacu.billing.service import platform_transaction


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['add', 'remove'])
    parser.add_argument('--user-id', required=True, type=UUID, help="The person's CACU sign-in account id (Supabase Auth user id)")
    parser.add_argument('--name', help='How the person is shown to owners, for example "Tolu (CACU support)"')
    args = parser.parse_args(argv)
    if args.action == 'add' and not (args.name or '').strip():
        parser.error('--name is required when adding someone')
    report = {'action': args.action, 'status': 'ok'}
    code = 0
    try:
        with platform_transaction() as cursor:
            cursor.execute('SELECT ops.set_support_staff(%s, %s, %s)', (args.user_id, args.name, args.action == 'add'))
            report.update(cursor.fetchone()[0])
    except Exception:
        report['status'] = 'error'  # never print account details
        code = 1
    print(json.dumps(report))
    return code


if __name__ == '__main__':
    raise SystemExit(main())
