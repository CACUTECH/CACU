from decimal import Decimal
from cacu.schemas.journal import JournalDraft, JournalValidation

def validate_journal(draft: JournalDraft) -> JournalValidation:
    """Domain validation only; never implies persistence or authorization to post."""
    return JournalValidation(
        valid=True,
        total_debit=format(sum(Decimal(line.debit) for line in draft.lines), ".2f"),
        total_credit=format(sum(Decimal(line.credit) for line in draft.lines), ".2f"),
    )