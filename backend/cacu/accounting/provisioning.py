"""Stage an accounting entity and stable account mappings for one business (privileged connection only).

Shared by tools/provision_entity.py and the activation step (cacu/accounting/activation.py). Nothing here
activates a business: business_map is written as 'staged' or by the caller.
Mapping: business_id, timezone, accounts[{id,account_type,flow_section,purpose}], parties[{type,id,account_id}].
"""
from python_accounting.models import Entity, Currency, Account, Category

FLOW_SECTIONS = {'cash', 'operating', 'investing', 'financing', 'restricted'}


def validate_mapping(mapping):
    for item in mapping['accounts']:
        Account.AccountType[item['account_type']]
        if item['flow_section'] not in FLOW_SECTIONS:
            raise ValueError('Unknown cash-flow section')
        if item['purpose'] in {'cash', 'bank'} and (item['account_type'] != 'BANK' or item['flow_section'] != 'cash'):
            raise ValueError('Cash/bank collection mappings require BANK type and cash flow section')
    if len({item['id'] for item in mapping['accounts']}) != len(mapping['accounts']):
        raise ValueError('Duplicate source account mapping')
    if sum(item['purpose'] == 'cash' for item in mapping['accounts']) > 1:
        raise ValueError('At most one reviewed cash collection mapping is supported')
    for party in mapping.get('parties', []):
        if party['type'] not in {'customers', 'suppliers'}:
            raise ValueError('Unknown counterparty type')


def provision(connection, session, business_id, mapping):
    """Create entity, NGN currency, library accounts, account_map and party_map. Returns (entity, {source id: library id}).
    The caller holds the tenant advisory lock and has set cacu.business_id for this transaction."""
    validate_mapping(mapping)
    tenant = str(business_id)
    source = connection.exec_driver_sql('SELECT name FROM public.businesses WHERE id=%s', (tenant,)).first()
    if not source:
        raise ValueError('Unknown existing CACU business')
    if connection.exec_driver_sql('SELECT 1 FROM accounting.business_map WHERE business_id=%s', (tenant,)).first():
        raise ValueError('Business already provisioned; review existing mapping')
    entity = Entity(name=source.name); session.add(entity); session.flush()
    currency = Currency(name='Nigerian Naira', code='NGN', entity_id=entity.id); session.add(currency); session.flush()
    entity.currency_id = currency.id; session.flush()
    library = {}; categories = {}
    for item in mapping['accounts']:
        account = connection.exec_driver_sql('SELECT name FROM public.accounts WHERE id=%s AND business_id=%s AND is_active', (item['id'], tenant)).first()
        if not account:
            raise ValueError('Unavailable CACU account')
        kind = Account.AccountType[item['account_type']]
        if kind not in categories:
            category = Category(name=item['account_type'].replace('_', ' ').title(), category_account_type=kind, entity_id=entity.id)
            session.add(category); session.flush(); categories[kind] = category.id
        model = Account(name=account.name, account_type=kind, currency_id=currency.id, entity_id=entity.id, category_id=categories[kind])
        session.add(model); session.flush(); library[item['id']] = model.id
        connection.exec_driver_sql('INSERT INTO accounting.account_map VALUES(%s,%s,%s,%s,%s)', (tenant, item['id'], model.id, item['flow_section'], item['purpose']))
    for party in mapping.get('parties', []):
        row = connection.exec_driver_sql(f"SELECT id FROM public.{party['type']} WHERE id=%s AND business_id=%s", (party['id'], tenant)).first()
        if not row:
            raise ValueError('Counterparty ownership mismatch')
        connection.exec_driver_sql('INSERT INTO accounting.party_map VALUES(%s,%s,%s,%s)', (tenant, party['type'], party['id'], library[party['account_id']]))
    return entity, library
