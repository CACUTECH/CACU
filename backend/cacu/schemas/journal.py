"""Base-currency contract. Money enters and leaves as decimal strings."""
import re
from datetime import date
from decimal import Decimal, InvalidOperation
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MAX_MONEY = Decimal("9999999999999.99")

class JournalLine(BaseModel):
    model_config = ConfigDict(extra="forbid")
    account_id: UUID
    debit: str = "0.00"
    credit: str = "0.00"
    description: str = Field(default="", max_length=500)

    @field_validator("debit", "credit", mode="before")
    @classmethod
    def money(cls, value):
        if not isinstance(value, str):
            raise ValueError("Money must be a decimal string")
        if not re.fullmatch(r'[0-9]{1,13}(\.[0-9]{1,2})?', value):
            raise ValueError('Money requires a bounded decimal literal')
        try:
            amount = Decimal(value)
        except InvalidOperation as exc:
            raise ValueError("Invalid money") from exc
        if not amount.is_finite() or amount < 0 or amount > MAX_MONEY:
            raise ValueError("Money must be finite, nonnegative and within numeric(15,2)")
        if amount != amount.quantize(Decimal("0.01")):
            raise ValueError("Money supports at most two fractional digits")
        return format(amount, ".2f")

    @model_validator(mode="after")
    def one_side(self):
        if (Decimal(self.debit) > 0) == (Decimal(self.credit) > 0):
            raise ValueError("A line must have exactly one positive debit or credit")
        return self

class JournalDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    date: date
    memo: str = Field(min_length=1, max_length=1000)
    lines: list[JournalLine] = Field(min_length=2, max_length=200)

    @model_validator(mode="after")
    def balanced(self):
        if sum(Decimal(line.debit) for line in self.lines) != sum(Decimal(line.credit) for line in self.lines):
            raise ValueError("Journal debits must equal credits")
        return self

class JournalValidation(BaseModel):
    valid: bool
    total_debit: str
    total_credit: str
    persisted: bool = False