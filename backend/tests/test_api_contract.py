"""API-014: the committed TypeScript contract (src/lib/accounting-contract.ts) lists exactly the routes the API serves.

The contract is generated with openapi-typescript from app.openapi(); this catches a route added, removed or
renamed without regenerating it. It compares paths and methods, not request and response shapes.
"""
import re
from pathlib import Path
import app

CONTRACT = Path(__file__).resolve().parents[2] / 'src' / 'lib' / 'accounting-contract.ts'


def contract_routes():
    text = CONTRACT.read_text(encoding='utf-8')
    block = text.split('export interface paths {', 1)[1].split('\nexport ', 1)[0]
    routes = set()
    for match in re.finditer(r'\n    "([^"]+)": \{(.*?)\n    \};', block, re.S):
        routes |= {(match.group(1), method) for method in ('get', 'post', 'put', 'patch', 'delete')
                   if re.search(rf'\n        {method}: operations', match.group(2))}
    return routes


def test_contract_lists_every_route_the_api_serves():
    served = {(path, method) for path, operations in app.app.openapi()['paths'].items() for method in operations}
    listed = contract_routes()
    assert len(listed) > 10, 'contract file could not be read'
    assert served - listed == set(), 'Regenerate src/lib/accounting-contract.ts: routes missing from the contract'
    assert listed - served == set(), 'Regenerate src/lib/accounting-contract.ts: the contract lists routes the API no longer serves'
