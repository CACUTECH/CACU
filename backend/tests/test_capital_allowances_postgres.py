"""Capital allowances (R4; Nigeria Tax Act 2025): off until a tax professional confirms the rates, on for CACU's preview
business; each asset's class and whether it qualifies are set by an Owner or Admin; nothing reaches the ledger."""
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.allowances import AssetTax, save, schedule
from cacu.accounting.assets import add_asset, overview
from test_fixed_assets_postgres import EARLIER_MONTH, asset, started
from test_corrections_postgres import live, call, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_activation_postgres import TODAY

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


def switch(on):
    with psycopg.connect(URL) as c:
        c.execute('UPDATE accounting.capital_allowance_switch SET enabled=%s', (on,))
        c.execute('DELETE FROM accounting.preview_business')


def ledger_rows(live):
    with psycopg.connect(URL) as c:
        return c.execute('SELECT count(*) FROM accounting.ledger WHERE business_id=%s', (live.business,)).fetchone()[0]


def test_off_until_reviewed_and_on_for_the_preview_business(live):
    started(live, EARLIER_MONTH)
    switch(False)
    call(live, 'owner', lambda s, a: add_asset(s, a, asset()))
    assert call(live, 'viewer', lambda s, a: overview(s))['capital_allowances'] is False
    with pytest.raises(HTTPException, match='not available yet'):
        call(live, 'owner', lambda s, a: schedule(s, TODAY.year))
    with psycopg.connect(URL) as c:
        c.execute("INSERT INTO accounting.preview_business(business_id, reason) VALUES (%s, 'CACU preview')", (live.business,))
    assert call(live, 'viewer', lambda s, a: overview(s))['capital_allowances'] is True
    year = call(live, 'viewer', lambda s, a: schedule(s, TODAY.year))
    laptop = year['assets'][0]
    assert (laptop['tax_class'], laptop['rate_percent'], laptop['allowance']) == ('other_equipment', '20.00', '240000.00')  # 20% of 1,200,000
    assert year['totals']['allowance'] == '240000.00' and year['reviewed'] is False
    with pytest.raises(HTTPException, match='start with 2026'):
        call(live, 'viewer', lambda s, a: schedule(s, 2025))
    switch(False)


def test_owners_set_each_assets_class_and_whether_it_qualifies(live):
    started(live, EARLIER_MONTH)
    switch(True)
    laptop = call(live, 'owner', lambda s, a: add_asset(s, a, asset()))
    before = ledger_rows(live)
    with pytest.raises(HTTPException) as refused:
        call(live, 'editor', lambda s, a: save(s, a, laptop['id'], AssetTax(tax_class='software')))
    assert refused.value.status_code == 403
    with pytest.raises(HTTPException, match='Only an asset bought before 2026'):
        call(live, 'owner', lambda s, a: save(s, a, laptop['id'], AssetTax(tax_class='plant', claimed_before='100.00')))
    with pytest.raises(HTTPException, match='Choose a capital allowance class'):
        call(live, 'owner', lambda s, a: save(s, a, laptop['id'], AssetTax(tax_class='spaceship')))
    call(live, 'admin', lambda s, a: save(s, a, laptop['id'], AssetTax(tax_class='software')))
    assert call(live, 'viewer', lambda s, a: schedule(s, TODAY.year))['assets'][0]['allowance'] == '300000.00'  # 25%
    call(live, 'owner', lambda s, a: save(s, a, laptop['id'], AssetTax(tax_class='software', qualifies=False, note='Bought from an unregistered seller; no VAT charged')))
    with pytest.raises(HTTPException, match='more than 0%'):
        call(live, 'owner', lambda s, a: save(s, a, laptop['id'], AssetTax(tax_class='software', business_use='0')))
    call(live, 'owner', lambda s, a: save(s, a, laptop['id'], AssetTax(tax_class='software', business_use='75')))
    part = call(live, 'viewer', lambda s, a: schedule(s, TODAY.year))
    assert (part['assets'][0]['allowance'], part['assets'][0]['private_use'], part['assets'][0]['business_use_percent']) == ('225000.00', '75000.00', '75.00')
    assert part['totals']['allowance'] == '225000.00'
    year = call(live, 'viewer', lambda s, a: schedule(s, TODAY.year))
    assert year['assets'][0]['qualifies'] is False and 'allowance' not in year['assets'][0] and year['totals']['allowance'] == '0.00'
    assert ledger_rows(live) == before  # a tax computation, never a posting
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE cacu_runtime')
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            c.execute('UPDATE accounting.capital_allowance_rate SET rate=0.5')
    switch(False)


def test_an_unknown_asset_is_not_found(live):
    switch(True)
    with pytest.raises(HTTPException) as missing:
        call(live, 'owner', lambda s, a: save(s, a, uuid4(), AssetTax(tax_class='plant')))
    assert missing.value.status_code == 404
    switch(False)
