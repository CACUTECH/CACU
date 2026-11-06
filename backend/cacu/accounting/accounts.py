"""Adding an account once the books are live (FR-131).

public.save_account records the account and its kind; this creates its ledger account in the library and links
the two through accounting.map_custom_account, all in the caller's transaction. Renaming, archiving and restoring
need no ledger change beyond what save_account does, so the browser calls save_account for those directly.
"""
import json
from typing import Literal
from uuid import UUID
from fastapi import HTTPException
from pydantic import BaseModel,ConfigDict,Field
from python_accounting.models import Account,Category
from cacu.accounting.posting import raw
from cacu.accounting.workflows import role

class AccountCreate(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_key:UUID
    kind:Literal['bank','current_asset','fixed_asset','current_liability','loan','equity','income','other_income','expense','other_expense']
    name:str=Field(min_length=1,max_length=100)

def account_create(session,actor,data:AccountCreate):
    return add_account(session,actor,data.request_key,data.kind,data.name)

def add_account(session,actor,request_key,kind,name):
    """Adds an account of a kind to live books and its ledger account; also used for system kinds such as customer
    deposits, which the chart screen does not offer."""
    if role(session,actor) not in {'owner','admin'}:raise HTTPException(403,'Only an Owner or Admin can change the chart of accounts')
    tenant=str(session.business_id)
    result=raw(session,'SELECT public.save_account(%s,%s,%s,NULL,%s::jsonb)',(tenant,str(request_key),'add',json.dumps({'kind':kind,'name':name}))).scalar()
    if raw(session,'SELECT 1 FROM accounting.account_map WHERE business_id=%s AND account_id=%s',(tenant,result['id'])).first():
        return result  # a retry of an add that already completed
    kind=Account.AccountType[result['library_type']]
    category=session.query(Category).filter(Category.entity_id==session.entity.id,Category.category_account_type==kind).first()
    if category is None:
        category=Category(name=result['library_type'].replace('_',' ').title(),category_account_type=kind,entity_id=session.entity.id)
        session.add(category);session.flush()
    ledger=Account(name=result['name'],account_type=kind,currency_id=session.entity.currency_id,entity_id=session.entity.id,category_id=category.id)
    session.add(ledger);session.flush()
    raw(session,'SELECT accounting.map_custom_account(%s,%s,%s)',(tenant,result['id'],ledger.id))
    return result
