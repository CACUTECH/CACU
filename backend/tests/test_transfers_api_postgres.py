"""Transfers awaiting confirmation through the native API: who may see and decide them (Doc 08 banking)."""
from uuid import uuid4
import pytest
from test_permissions_switch_postgres import api, assign, URL  # noqa: F401  (fixtures)
from test_library_postgres import database  # noqa: F401

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


def test_editors_see_waiting_transfers_but_only_banking_post_decides_and_cashiers_see_none(api):
    d, staff, client = api
    base = f'/api/v1/businesses/{d[1]}'
    detail = lambda response: str(response.json().get('detail', ''))
    listed = client.get(f'{base}/transfers')
    assert listed.status_code == 200 and listed.json() == []  # Editor (legacy): banking.view
    assert client.get(f'{base}/reconciliation/daily', params={'day': f'{d[6]}-02-10'}).json()['pending'] == []
    refused = client.post(f'{base}/transfers/{uuid4()}/confirm', json={'request_key': str(uuid4()), 'bank_account_id': str(d[4]['cash2'][0])})
    assert refused.status_code == 403 and 'You do not have permission' in detail(refused)  # no banking.post
    generic = client.post(f'{base}/postings', json={'request_key': str(uuid4()), 'kind': 'transfer_confirmation', 'source_id': str(uuid4()),
                          'main_account_id': str(d[4]['cash2'][0]), 'entry_date': f'{d[6]}-02-10', 'narration': 'x',
                          'lines': [{'account_id': str(d[4]['transfer_clearing'][0]), 'amount': '1.00', 'credited': True}]})
    assert generic.status_code in {403, 422}
    assign(d[1], staff, 'cashier')
    assert client.get(f'{base}/transfers').status_code == 403
