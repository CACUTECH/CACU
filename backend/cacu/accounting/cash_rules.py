"""Explicit period-effective IAS 7 classifications. Never infer cash status from a restriction."""
from datetime import date
from typing import Literal
from uuid import UUID
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from cacu.accounting.posting import raw
from cacu.accounting.workflows import role, durable

class CashClassification(BaseModel):
    model_config = ConfigDict(extra='forbid',str_strip_whitespace=True)
    request_key: UUID
    account_id: UUID
    effective_from: date
    nature: Literal['other','interest_paid','interest_received','dividends_paid','dividends_received','income_tax'] = 'other'
    section: Literal['cash','operating','investing','financing']
    cash_eligible: bool = False
    restricted: bool = False
    evidence: str = Field(min_length=10, max_length=2000)


def save_classification(session, actor, data: CashClassification):
    def execute():
        if role(session, actor) not in {'owner','admin'}:
            raise HTTPException(403, 'Owner or Admin approval required')
        if not data.evidence.strip() or (data.section == 'cash') != data.cash_eligible or (data.cash_eligible and data.nature != 'other'):
            raise HTTPException(422, 'Cash eligibility and transaction classification must agree')
        if raw(session,'SELECT 1 FROM accounting.cash_flow_classification WHERE business_id=%s AND account_id=%s AND effective_from=%s',(str(session.business_id),str(data.account_id),data.effective_from)).first():
            raise HTTPException(409,'This effective-date classification is immutable; use a separately reviewed policy transition')
        row = raw(session, 'SELECT a.account_type::text FROM accounting.account_map m JOIN accounting.account a ON a.id=m.library_id AND a.business_id=m.business_id WHERE m.business_id=%s AND m.account_id=%s', (str(session.business_id), str(data.account_id))).first()
        if not row: raise HTTPException(422, 'Mapped account required')
        if data.cash_eligible and row[0] not in {'BANK','CURRENT_ASSET','CURRENT_LIABILITY'}:
            raise HTTPException(422, 'Review cash-equivalent or integral overdraft eligibility before classification')
        raw(session, """INSERT INTO accounting.cash_flow_classification
          (business_id,account_id,effective_from,nature,section,cash_eligible,restricted,evidence,approved_by)
          VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)""", (str(session.business_id),str(data.account_id),data.effective_from,data.nature,data.section,data.cash_eligible,data.restricted,data.evidence.strip(),str(actor)))
        return data.model_dump(mode='json')
    return durable(session, actor, 'cash_classification', data, execute)


def classifications(session, start, end):
    rows = raw(session, """SELECT DISTINCT ON(account_id) account_id::text,nature,section,cash_eligible,restricted,evidence,effective_from
      FROM accounting.cash_flow_classification WHERE business_id=%s AND effective_from<=%s
      ORDER BY account_id,effective_from DESC""", (str(session.business_id), end)).mappings()
    result = {r['account_id']:dict(r) for r in rows}
    if any(start < r['effective_from'] <= end for r in result.values()):
        raise HTTPException(409, 'Split this report at the cash-classification effective date')
    return result


def apply_classifications(rows, policies):
    result = []
    for source in rows:
        row = dict(source)
        policy = policies.get(str(row['source_account_id']))
        if policy:
            row['flow_section'] = policy['section']
            row['cash_nature'] = policy['nature']
        else:
            # Stable template purpose, supplied by the ledger query; custom accounts need an explicit policy.
            row['cash_nature'] = row.get('purpose') if row.get('purpose') in {'interest_paid','interest_received','dividends_paid','dividends_received','income_tax'} else 'other'
        folio = policies.get(str(row.get('folio_source_id')))
        if folio: row['folio_section'] = folio['section']
        if row['flow_section'] == 'restricted' or row['folio_section'] == 'restricted':
            raise HTTPException(409, 'Restricted balances require reviewed cash eligibility and flow classification')
        result.append(row)
    return result

DISCLOSURE_LABELS = {'interest_paid':'Interest paid','interest_received':'Interest received',
    'dividends_paid':'Dividends paid','dividends_received':'Dividends received','income_tax':'Income taxes paid / refunded'}
