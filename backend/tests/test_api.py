from fastapi.testclient import TestClient
from app import app

client = TestClient(app)

def test_health_no_secrets():
    assert client.get("/health").json() == {"status": "ok"}

def test_no_cookie_or_unauthenticated_authorization():
    response = client.post("/v1/businesses/00000000-0000-0000-0000-000000000001/journals/validate", json={})
    assert response.status_code == 401

def test_no_posting_route_before_database_boundary():
    assert client.post("/v1/businesses/00000000-0000-0000-0000-000000000001/journals").status_code == 404
def test_large_body_rejected_before_validation():
    assert client.post("/v1/businesses/00000000-0000-0000-0000-000000000001/journals/validate", content=b"x" * 131073).status_code == 413

def test_collection_account_list_requires_bearer_authentication():
    assert client.get('/api/v1/businesses/00000000-0000-0000-0000-000000000001/collection-accounts').status_code==401


import pytest
@pytest.mark.parametrize('path', ['inventory/valuation','reporting-close','reporting-close/00000000-0000-0000-0000-000000000002'])
def test_ifrs_read_routes_require_bearer(path):
    assert client.get('/api/v1/businesses/00000000-0000-0000-0000-000000000001/'+path).status_code==401

@pytest.mark.parametrize('path', ['inventory/policy','inventory/adopt','inventory/receipts','inventory/nrv','inventory/returns','cash-flow-classifications','reporting-close','reporting-close/00000000-0000-0000-0000-000000000002/approve'])
def test_ifrs_writes_require_bearer(path):
    assert client.post('/api/v1/businesses/00000000-0000-0000-0000-000000000001/'+path,json={}).status_code==401
