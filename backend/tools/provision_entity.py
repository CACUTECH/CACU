"""Explicit, privileged staging tool. Does not activate a business or create tables.
Mapping input: business_id, timezone, accounts[{id,account_type,flow_section,purpose}],
parties[{type,id,account_id}]. Run with --apply only against a reviewed staging database.
To post an approved opening position and turn the books on, use tools/activate_books.py instead.
"""
import argparse,json,os
from pathlib import Path
from uuid import UUID
from sqlalchemy import create_engine
from cacu.accounting.provisioning import provision,validate_mapping
from cacu.accounting.session import AtomicAccountingSession

parser=argparse.ArgumentParser();parser.add_argument('mapping',type=Path);parser.add_argument('--apply',action='store_true')
args=parser.parse_args();mapping=json.loads(args.mapping.read_text());business=UUID(mapping['business_id'])
for item in mapping['accounts']:UUID(item['id'])
validate_mapping(mapping)
print('Validated mapping for business',business,'with',len(mapping['accounts']),'accounts. State will remain staged.')
if not args.apply:raise SystemExit('Dry run. No database changes.')
dsn=os.environ.get('CACU_MIGRATION_DATABASE_URL')
if not dsn:raise SystemExit('Privileged staging migration URL is required')
dsn=dsn.replace('postgresql://','postgresql+psycopg://',1)
engine=create_engine(dsn,hide_parameters=True,connect_args={'sslmode':'verify-full','prepare_threshold':None})
with engine.begin() as connection:
    connection.exec_driver_sql("SELECT set_config('cacu.business_id',%s,true),set_config('search_path','accounting,public,pg_catalog',true)",(str(business),))
    connection.exec_driver_sql('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))',(str(business),))
    session=AtomicAccountingSession(bind=connection,info={'ignore_isolation':False,'include_deleted':False})
    entity,_=provision(connection,session,business,mapping)
    connection.exec_driver_sql("INSERT INTO accounting.business_map(business_id,entity_id,timezone,state) VALUES(%s,%s,%s,'staged')",(str(business),entity.id,mapping.get('timezone','Africa/Lagos')))
    session.flush();session.close()
engine.dispose();print('Staged entity and stable account mappings created. No cutover performed.')
