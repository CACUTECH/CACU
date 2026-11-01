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

@given(st.integers(min_value=1,max_value=10**12),st.integers(min_value=2,max_value=1000))
def test_inventory_issues_preserve_exact_cost_and_last_unit_residual(total_cents,units):
    from cacu.accounting.inventory import proportion
    cost=Decimal(total_cents)/100
    first=proportion(cost,1,units)
    remaining=cost-first
    final=proportion(remaining,units-1,units-1)
    assert first>=0 and final>=0 and first+final==cost
