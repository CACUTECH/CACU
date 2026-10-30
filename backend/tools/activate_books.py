"""Explicit, privileged tool. Turns on a business's books from its approved opening position (RB-05, FR-130).
Dry run by default: every check, the provisioning and the opening posting run inside one transaction that is
rolled back, and the reconciliation evidence is printed. --apply commits it. Use staging first; production only
after the accountant review (DEP-02) and with the restricted runtime login in place (DEP-01).
--staging-unreviewed allows a chart template still awaiting accountant review, for staging databases only.
"""
import argparse,json,os
from uuid import UUID
from sqlalchemy import create_engine
from cacu.accounting.activation import ActivationError,activate

parser=argparse.ArgumentParser();parser.add_argument('business_id',type=UUID)
parser.add_argument('--operator',type=UUID,required=True,help='Owner or Admin user id who asked for the books to be turned on')
parser.add_argument('--apply',action='store_true');parser.add_argument('--staging-unreviewed',action='store_true')
args=parser.parse_args()
dsn=os.environ.get('CACU_MIGRATION_DATABASE_URL')
if not dsn:raise SystemExit('Privileged migration URL is required')
dsn=dsn.replace('postgresql://','postgresql+psycopg://',1)
engine=create_engine(dsn,hide_parameters=True,connect_args={'sslmode':'verify-full','prepare_threshold':None})
try:
    with engine.connect() as connection:
        transaction=connection.begin()
        try:
            evidence=activate(connection,args.business_id,args.operator,allow_unreviewed=args.staging_unreviewed)
        except ActivationError as error:
            transaction.rollback();raise SystemExit(f'Not activated. {error}')
        print(json.dumps(evidence,indent=2))
        if args.apply:
            transaction.commit();print('Books are live from',evidence['start_date'])
        else:
            transaction.rollback();print('Dry run. All checks passed; nothing was changed. Re-run with --apply to turn the books on.')
finally:
    engine.dispose()
