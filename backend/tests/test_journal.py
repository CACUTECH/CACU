from uuid import uuid4
import pytest
from pydantic import ValidationError
from cacu.schemas.journal import JournalDraft, JournalLine
from cacu.services.accounting.journal import validate_journal

def line(debit="0.00", credit="0.00"):
    return {"account_id": str(uuid4()), "debit": debit, "credit": credit}

@pytest.mark.parametrize("amount", ["NaN", "Infinity", "-1", "0.001", "10000000000000", 0.1, None, "bad"])
def test_invalid_money(amount):
    with pytest.raises(ValidationError):
        JournalLine(**line(debit=amount))

@pytest.mark.parametrize("debit,credit", [("0", "0"), ("1", "1")])
def test_exactly_one_side(debit, credit):
    with pytest.raises(ValidationError):
        JournalLine(**line(debit, credit))

def test_unbalanced():
    with pytest.raises(ValidationError):
        JournalDraft(date="2026-10-11", memo="Test", lines=[line("1.00"), line(credit="0.99")])

def test_decimal_not_float():
    draft = JournalDraft(date="2026-10-11", memo="Exact", lines=[line("0.10"), line("0.20"), line(credit="0.30")])
    result = validate_journal(draft)
    assert result.total_debit == result.total_credit == "0.30"
    assert result.persisted is False

def test_single_line_and_extra_fields_rejected():
    with pytest.raises(ValidationError):
        JournalDraft(date="2026-10-11", memo="Test", lines=[line("1")], business_id=str(uuid4()))