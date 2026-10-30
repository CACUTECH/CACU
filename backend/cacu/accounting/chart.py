"""Default chart of accounts to provisioning mapping (Doc 09 section 4, ACC-012).

The template lives in onboarding_private.chart_template_accounts; a business adopts it through
public.adopt_default_chart. This module turns an adopted chart into the mapping that
tools/provision_entity.py stages, and checks the same rules that tool enforces.
"""
from python_accounting.models import Account

FLOW_SECTIONS = {'cash', 'operating', 'investing', 'financing', 'restricted'}
SINGLE_PURPOSES = {'cash', 'revenue', 'equity', 'inventory', 'cogs'}  # looked up with workflows.purpose()


def required_purposes(mode):
    return {'cash', 'revenue', 'equity'} | ({'inventory', 'cogs'} if mode in {'PRODUCT', 'HYBRID'} else set())


def validate(mode, accounts):
    """Raise ValueError unless the accounts can be provisioned and posted to for the business mode."""
    if len({a['id'] for a in accounts}) != len(accounts):
        raise ValueError('Duplicate source account mapping')
    for a in accounts:
        Account.AccountType[a['account_type']]
        if a['flow_section'] not in FLOW_SECTIONS:
            raise ValueError(f"Unknown cash-flow section for {a['code']}")
        if a['purpose'] in {'cash', 'bank'} and (a['account_type'] != 'BANK' or a['flow_section'] != 'cash'):
            raise ValueError('Cash/bank collection mappings require BANK type and cash flow section')
    counts = {}
    for a in accounts:
        if a['purpose']:
            counts[a['purpose']] = counts.get(a['purpose'], 0) + 1
    duplicated = sorted(p for p in SINGLE_PURPOSES if counts.get(p, 0) > 1)
    missing = sorted(p for p in required_purposes(mode) if not counts.get(p))
    if duplicated or missing:
        raise ValueError(f'Purposes missing {missing} or duplicated {duplicated}')


def build_mapping(connection, business_id, allow_unreviewed=False):
    """Read an adopted chart (privileged connection) and return the provisioning mapping."""
    adoption = connection.execute("""SELECT a.version, a.mode, t.status FROM onboarding_private.chart_adoptions a
        JOIN onboarding_private.chart_templates t USING (version) WHERE a.business_id = %s""", (str(business_id),)).fetchone()
    if not adoption:
        raise ValueError('Business has not adopted the default chart')
    version, mode, status = adoption
    if status != 'reviewed' and not allow_unreviewed:
        raise ValueError(f'Chart template {version} is awaiting accountant review (DEP-02)')
    rows = connection.execute("""SELECT acc.id, acc.code, t.library_type, t.flow_section, t.purpose
        FROM public.accounts acc JOIN onboarding_private.chart_template_accounts t
          ON t.version = %s AND t.mode = %s AND t.code = acc.code
        WHERE acc.business_id = %s AND acc.is_active ORDER BY acc.code""", (version, mode, str(business_id))).fetchall()
    accounts = [{'id': str(r[0]), 'code': r[1], 'account_type': r[2], 'flow_section': r[3], 'purpose': r[4] or 'other'} for r in rows]
    validate(mode, [{**a, 'purpose': None if a['purpose'] == 'other' else a['purpose']} for a in accounts])
    by_purpose = {a['purpose']: a['id'] for a in accounts}
    parties = [{'type': 'customers', 'id': str(r[0]), 'account_id': by_purpose['receivables']}
               for r in connection.execute('SELECT id FROM public.customers WHERE business_id = %s ORDER BY id', (str(business_id),))]
    parties += [{'type': 'suppliers', 'id': str(r[0]), 'account_id': by_purpose['payables']}
                for r in connection.execute('SELECT id FROM public.suppliers WHERE business_id = %s ORDER BY id', (str(business_id),))]
    return {'business_id': str(business_id), 'timezone': 'Africa/Lagos',
            'template': version, 'template_status': status, 'accounts': [{k: a[k] for k in ('id', 'account_type', 'flow_section', 'purpose')} for a in accounts],
            'parties': parties}
