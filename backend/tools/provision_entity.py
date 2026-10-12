"""Explicit, privileged staging tool. Does not activate a business or create tables.
Mapping input: business_id, timezone, accounts[{id,account_type,flow_section,purpose}],
parties[{type,id,account_id}]. Run with --apply only against a reviewed staging database.
"""
import argparse,json,os
from pathlib import Path
from uuid import UUID
from sqlalchemy import create_engine
from python_accounting.models import Entity,Currency,Account,Category
from cacu.accounting.session import AtomicAccountingSession

parser=argparse.ArgumentParser();parser.add_argument('mapping',type=Path);parser.add_argument('--apply',action='store_true')
args=parser.parse_args();mapping=json.loads(args.mapping.read_text());business=UUID(mapping['business_id'])
for item in mapping['accounts']:
    UUID(item['id']);Account.AccountType[item['account_type']]
    assert item['flow_section'] in {'cash','operating','investing','financing','restricted'}
    if item['purpose'] in {'cash','bank'} and (item['account_type']!='BANK' or item['flow_section']!='cash'):
        raise ValueError('Cash/bank collection mappings require BANK type and cash flow section')
if len({item['id'] for item in mapping['accounts']})!=len(mapping['accounts']):raise ValueError('Duplicate source account mapping')
if sum(item['purpose']=='cash' for item in mapping['accounts'])>1:raise ValueError('At most one reviewed cash collection mapping is supported')
print('Validated mapping for business',business,'with',len(mapping['accounts']),'accounts. State will remain staged.')
if not args.apply:raise SystemExit('Dry run. No database changes.')
dsn=os.environ.get('CACU_MIGRATION_DATABASE_URL')
if not dsn:raise SystemExit('Privileged staging migration URL is required')
dsn=dsn.replace('postgresql://','postgresql+psycopg://',1)
engine=create_engine(dsn,hide_parameters=True,connect_args={'sslmode':'verify-full','prepare_threshold':None})
with engine.begin() as connection:
    connection.exec_driver_sql("SELECT set_config('cacu.business_id',%s,true),set_config('search_path','accounting,public,pg_catalog',true)",(str(business),))
    connection.exec_driver_sql('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))',(str(business),))
    source=connection.exec_driver_sql('SELECT name FROM public.businesses WHERE id=%s',(str(business),)).first()
    if not source:raise ValueError('Unknown existing CACU business')
    if connection.exec_driver_sql('SELECT 1 FROM accounting.business_map WHERE business_id=%s',(str(business),)).first():raise ValueError('Business already provisioned; review existing mapping')
    session=AtomicAccountingSession(bind=connection,info={'ignore_isolation':False,'include_deleted':False})
    entity=Entity(name=source.name);session.add(entity);session.flush()
    currency=Currency(name='Nigerian Naira',code='NGN',entity_id=entity.id);session.add(currency);session.flush();entity.currency_id=currency.id;session.flush()
    library={};categories={}
    for item in mapping['accounts']:
        account=connection.exec_driver_sql('SELECT name FROM public.accounts WHERE id=%s AND business_id=%s AND is_active',(item['id'],str(business))).first()
        if not account:raise ValueError('Unavailable CACU account')
        kind=Account.AccountType[item['account_type']]
        if kind not in categories:
            category=Category(name=item['account_type'].replace('_',' ').title(),category_account_type=kind,entity_id=entity.id)
            session.add(category);session.flush();categories[kind]=category.id
        model=Account(name=account.name,account_type=kind,currency_id=currency.id,entity_id=entity.id,category_id=categories[kind])
        session.add(model);session.flush();library[item['id']]=model.id
        connection.exec_driver_sql('INSERT INTO accounting.account_map VALUES(%s,%s,%s,%s,%s)',(str(business),item['id'],model.id,item['flow_section'],item['purpose']))
    for party in mapping.get('parties',[]):
        assert party['type'] in {'customers','suppliers'}
        row=connection.exec_driver_sql(f"SELECT id FROM public.{party['type']} WHERE id=%s AND business_id=%s",(party['id'],str(business))).first()
        if not row:raise ValueError('Counterparty ownership mismatch')
        connection.exec_driver_sql('INSERT INTO accounting.party_map VALUES(%s,%s,%s,%s)',(str(business),party['type'],party['id'],library[party['account_id']]))
    connection.exec_driver_sql("INSERT INTO accounting.business_map(business_id,entity_id,timezone,state) VALUES(%s,%s,%s,'staged')",(str(business),entity.id,mapping.get('timezone','Africa/Lagos')))
    session.flush();session.close()
engine.dispose();print('Staged entity and stable account mappings created. No cutover performed.')
