"""Trusted cleanup operator: only expired managed uploads, never legacy objects."""
import argparse
import json
from cacu.uploads.service import UploadGateway, cleanup


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true', help='Claim and remove expired managed uploads (maximum 100)')
    parser.add_argument('--json', action='store_true', help='Emit counts and status only, without object paths or provider details')
    args = parser.parse_args(argv)
    report = {'mode': 'apply' if args.apply else 'dry-run', 'status': 'ok', 'claimed': 0, 'removed': 0, 'failed': 0}
    gateway = None
    code = 0
    if args.apply:
        try:
            gateway = UploadGateway('')
            rows = gateway.rpc('claim_upload_orphans', privileged=True)
            if not isinstance(rows, list) or len(rows) > 100:
                raise ValueError('Invalid cleanup batch')
            report['claimed'] = len(rows)
            report['removed'] = sum(cleanup(gateway, row, 'deleted') for row in rows)
            report['failed'] = report['claimed'] - report['removed']
            if report['failed']:
                report['status'] = 'retry_required'
                code = 1
        except Exception:
            # Operator failure must be visible to the scheduler; never print provider bodies or credentials.
            report['status'] = 'error'
            code = 1
        finally:
            if gateway is not None:
                gateway.close()
    if args.json:
        print(json.dumps(report, sort_keys=True))
    elif not args.apply:
        print('No changes. Use --apply to clean expired managed uploads.')
    else:
        print(f"Cleanup {report['status']}: claimed {report['claimed']}; removed {report['removed']}; failed {report['failed']}.")
    return code


if __name__ == '__main__':
    raise SystemExit(main())
