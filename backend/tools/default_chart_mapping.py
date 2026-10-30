"""Explicit, privileged tool. Writes the provisioning mapping for a business's adopted default chart.
Read-only: it changes nothing. Feed the output to tools/provision_entity.py after review.
Refuses an unreviewed template unless --staging-unreviewed is given for a staging database.
"""
import argparse,json,os
from pathlib import Path
from uuid import UUID
import psycopg
from cacu.accounting.chart import build_mapping

parser=argparse.ArgumentParser();parser.add_argument('business_id',type=UUID);parser.add_argument('output',type=Path)
parser.add_argument('--staging-unreviewed',action='store_true');args=parser.parse_args()
dsn=os.environ.get('CACU_MIGRATION_DATABASE_URL')
if not dsn:raise SystemExit('Privileged migration URL is required')
with psycopg.connect(dsn,sslmode='verify-full') as connection:
    connection.read_only=True
    mapping=build_mapping(connection,args.business_id,allow_unreviewed=args.staging_unreviewed)
args.output.write_text(json.dumps(mapping,indent=2));print('Wrote mapping for',len(mapping['accounts']),'accounts to',args.output)
