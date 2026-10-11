from decimal import Decimal
from uuid import uuid4
from hypothesis import given, strategies as st
from cacu.schemas.journal import JournalDraft
from cacu.services.accounting.journal import validate_journal

@given(st.integers(min_value=1, max_value=10**10), st.integers(min_value=1, max_value=10**10))
def test_split_debits_balance_exactly(first, second):
    a, b = Decimal(first) / 100, Decimal(second) / 100
    draft = JournalDraft(date="2026-10-11", memo="Split posting", lines=[
        {"account_id": str(uuid4()), "debit": format(a, ".2f")},
        {"account_id": str(uuid4()), "debit": format(b, ".2f")},
        {"account_id": str(uuid4()), "credit": format(a + b, ".2f")},
    ])
    result = validate_journal(draft)
    assert Decimal(result.total_debit) == a + b == Decimal(result.total_credit)
    assert result.persisted is False