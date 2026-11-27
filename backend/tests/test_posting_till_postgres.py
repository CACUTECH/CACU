"""Shape checks on internal postings answer with their own message, never a collection error: an account that is not a
bank is simply not one, and a business without a till (or whose till is not usable) is checked without needing it."""
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.posting import PostingCommand, post_command
from test_corrections_postgres import live, call, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_activation_postgres import TODAY

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


def refund(live, paid_from):
    return lambda s, a: post_command(s, a, PostingCommand(request_key=uuid4(), kind='sale_refund', source_id=uuid4(),
        main_account_id=live.codes[paid_from], entry_date=TODAY, narration='Refund', credited=True,
        lines=[{'account_id': live.codes['4000'], 'amount': '1000.00', 'credited': False}]), internal=True)


def test_a_refund_from_an_account_that_is_not_a_bank_is_refused_plainly(live):
    with pytest.raises(HTTPException, match='A refund is paid from the till or a bank account') as refused:
        call(live, 'owner', refund(live, '6200'))
    assert refused.value.status_code == 422


def test_without_a_usable_till_the_check_still_answers_plainly(live):
    with psycopg.connect(URL) as c:  # the till is no longer a cash account the business can collect into
        c.execute("UPDATE accounting.account_map SET flow_section='restricted' WHERE business_id=%s AND account_id=%s", (live.business, live.codes['1000']))
    with pytest.raises(HTTPException, match='A refund is paid from the till or a bank account'):
        call(live, 'owner', refund(live, '1000'))
