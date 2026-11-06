from uuid import UUID
from datetime import date
from decimal import Decimal
from sqlalchemy.exc import SQLAlchemyError
from cacu.accounting.session import library_transaction
from cacu.accounting.reports import cash_flow, financial_summary
from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
import psycopg
from cacu.auth.session import verify_user
from cacu.repositories.context import authorized_transaction
from cacu.schemas.journal import JournalDraft, JournalValidation
from cacu.services.accounting.journal import validate_journal

app = FastAPI(title="CACU Accounting API", version="0.1.0")
bearer = HTTPBearer(auto_error=False)

class BodyLimit:
    def __init__(self, app, max_bytes=131072):
        self.application, self.max_bytes = app, max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in {"POST", "PUT", "PATCH"}:
            return await self.application(scope, receive, send)
        # Upload routes use bounded binary bodies; other API requests retain their original limit.
        import re
        maximum = 3145728 if scope['method']=='POST' and re.fullmatch(r'/api/v1/businesses/[0-9a-fA-F-]{36}/files', scope['path']) else self.max_bytes
        messages, size = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            size += len(message.get("body", b""))
            if size > maximum:
                return await JSONResponse(status_code=413, content={"detail": "Request too large"})(scope, receive, send)
            messages.append(message)
            if not message.get("more_body", False):
                break
        async def bounded_receive():
            if messages:
                return messages.pop(0)
            return await receive()
        await self.application(scope, bounded_receive, send)

app.add_middleware(BodyLimit)

@app.exception_handler(RequestValidationError)
async def invalid_request(request, exc):
    # Do not echo payloads, account IDs or validation exception objects into logs/responses.
    return JSONResponse(status_code=422, content={"detail": "Invalid accounting request"})

@app.exception_handler(psycopg.Error)
async def database_error(request, exc):
    return JSONResponse(status_code=503, content={"detail": "Accounting database unavailable"})

async def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> UUID:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(401, "Bearer authentication required")
    return await verify_user(credentials.credentials)

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/v1/businesses/{business_id}/journals/validate", response_model=JournalValidation)
def validate(business_id: UUID, draft: JournalDraft, user_id: UUID = Depends(current_user)):
    with authorized_transaction(user_id, business_id, write=True) as cursor:
        # Validate account ownership/status against authoritative records.
        # account schema is an explicit verification gate; missing columns fail closed.
        for line in draft.lines:
            cursor.execute("SELECT id FROM public.accounts WHERE id = %s AND business_id = %s AND is_active = true", (line.account_id, business_id))
            if not cursor.fetchone():
                raise HTTPException(422, "Invalid posting account")
        return validate_journal(draft)

# Posting is gated by an explicitly reconciled business mapping; no startup DDL.
@app.exception_handler(SQLAlchemyError)
async def library_database_error(request, exc):
    return JSONResponse(status_code=503, content={"detail": "Accounting database unavailable"})

@app.get('/api/v1/businesses/{business_id}/reports/cash-flow')
def cash_flow_report(business_id: UUID,start_date:date,end_date:date,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id) as session:
        return cash_flow(session,start_date,end_date)

@app.get('/api/v1/businesses/{business_id}/reports/summary')
def accounting_summary(business_id: UUID,start_date:date,end_date:date,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id) as session:
        return financial_summary(session,start_date,end_date)

@app.get('/api/v1/businesses/{business_id}/reports/trial-balance')
def trial_balance_report(business_id:UUID,as_of:date,user_id:UUID=Depends(current_user)):
    from cacu.accounting.reports import trial_balance
    with library_transaction(user_id,business_id) as session:
        return trial_balance(session,as_of)

@app.get('/api/v1/businesses/{business_id}/reports/statements')
def financial_statements(business_id:UUID,start_date:date,end_date:date,compare:str|None=None,user_id:UUID=Depends(current_user)):
    from cacu.accounting.reports import statements
    with library_transaction(user_id,business_id) as session:
        return statements(session,start_date,end_date,compare)

@app.get('/api/v1/businesses/{business_id}/reports/general-ledger')
def general_ledger_report(business_id:UUID,account_id:UUID,start_date:date,end_date:date,page:int=0,user_id:UUID=Depends(current_user)):
    from cacu.accounting.reports import general_ledger
    with library_transaction(user_id,business_id) as session:
        return general_ledger(session,account_id,start_date,end_date,page)

from cacu.accounting.posting import PostingCommand,post_command

# Doc 08 permission each posting kind needs. Corrections (reversal, credit note) are also Owner/Admin-only in post_command.
POSTING_PERMISSIONS={'invoice':'invoices.post','receipt':'invoices.post','credit_note':'invoices.post','pos':'sales.post',
    'expense':'expenses.post','bill':'expenses.post','supplier_payment':'expenses.post','adjustment':'ledger.post',
    'reversal':'ledger.post','transfer':'banking.post'}

@app.post('/api/v1/businesses/{business_id}/postings')
def accounting_posting(business_id:UUID,command:PostingCommand,user_id:UUID=Depends(current_user)):
    # Collecting what customers already owe stays open while the subscription is suspended (SUB-10).
    with library_transaction(user_id,business_id,write=True,while_read_only=command.kind=='receipt',permission=POSTING_PERMISSIONS[command.kind]) as session:
        return post_command(session,user_id,command)

from cacu.accounting.workflows import InvoiceCreate,ReceiptCreate,SaleCreate,invoice_create,receipt_create,sale_create

@app.get('/api/v1/businesses/{business_id}/collection-accounts')
def collection_accounts(business_id:UUID,user_id:UUID=Depends(current_user)):
    from cacu.accounting.workflows import bank_accounts
    with library_transaction(user_id,business_id) as session:
        return bank_accounts(session)

@app.post('/api/v1/businesses/{business_id}/invoices')
def create_invoice(business_id:UUID,data:InvoiceCreate,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='invoices.post' if data.issue else 'invoices.create') as session:
        return invoice_create(session,user_id,data)

@app.post('/api/v1/businesses/{business_id}/receipts')
def create_receipt(business_id:UUID,data:ReceiptCreate,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,while_read_only=True,permission='invoices.post') as session:
        return receipt_create(session,user_id,data)

@app.post('/api/v1/businesses/{business_id}/sales')
def create_sale(business_id:UUID,data:SaleCreate,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='sales.post') as session:
        return sale_create(session,user_id,data)

from python_accounting.exceptions import AccountingExeption

@app.exception_handler(AccountingExeption)
async def accounting_rule_error(request,exc):
    return JSONResponse(status_code=409,content={'detail':'Accounting period, account classification or allocation rule rejected this operation'})

class JournalPosting(JournalDraft):
    request_key: UUID

@app.post('/api/v1/businesses/{business_id}/journals')
def post_balanced_journal(business_id:UUID,draft:JournalPosting,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='ledger.post') as session:
        validate_journal(draft)
        if len(draft.lines)>101:
            raise HTTPException(422,'At most 101 journal lines are supported')
        main=draft.lines[0]
        command=PostingCommand(request_key=draft.request_key,kind='adjustment',source_id=draft.request_key,
          main_account_id=main.account_id,entry_date=draft.date,narration=draft.memo,
          credited=Decimal(main.credit)>0,main_amount=format(max(Decimal(main.debit),Decimal(main.credit)),'.2f'),
          lines=[{'account_id':line.account_id,'amount':format(max(Decimal(line.debit),Decimal(line.credit)),'.2f'),'credited':Decimal(line.credit)>0,'description':line.description} for line in draft.lines[1:]])
        return post_command(session,user_id,command)

@app.get('/api/v1/businesses/{business_id}/invoices/balances')
def invoice_balances(business_id:UUID,user_id:UUID=Depends(current_user)):
    from python_accounting.models import Transaction
    with library_transaction(user_id,business_id) as session:
        rows=session.connection().exec_driver_sql("SELECT source_id,transaction_id FROM accounting.document_map WHERE business_id=%s AND source_type='invoice'",(str(business_id),)).all()
        result=[]
        for row in rows:
            transaction=session.get(Transaction,row.transaction_id)
            result.append({'id':str(row.source_id),'total':format(transaction.amount,'.2f'),'outstanding':format(transaction.amount-transaction.cleared(session),'.2f')})
        return result

from cacu.uploads.routes import upload_router
app.include_router(upload_router(current_user, bearer))

from cacu.accounting.catalog import CatalogMutation,catalog_mutate

CATALOG_MESSAGES={'VERSION_CONFLICT':'Item changed. Refresh before editing.', 'DUPLICATE_CODE':'Code already exists in this business.',
    'ITEM_STRUCTURE_LOCKED':'Referenced item type, stock unit and tracking cannot change.',
    'COST_REVALUATION_REQUIRED':'On-hand inventory cost changes require a reviewed revaluation.',
    'INVALID_STOCK_ADJUSTMENT':'Check the quantity, reason, date and available stock.',
    'ADJUSTMENT_ALREADY_DECIDED':'This adjustment was already decided.',
    'CATEGORY_INVALID':'Select an active category for this item type.', 'SUPPLIER_INVALID':'Select a supplier in this business.',
    'PLAN_LIMIT catalog.max_items':'Your plan has no room for more catalogue items. Archive items you no longer sell, or upgrade in Billing.'}

def catalog_write(business_id,user_id,work,permission=None):
    try:
        with library_transaction(user_id,business_id,write=True,permission=permission) as session:
            return work(session)
    except SQLAlchemyError as exc:
        code=getattr(exc.orig,'sqlstate',None)
        if code in {'P0001','23505','23514','22P02','22003','22007','22008','42501'}:
            reason=str(exc.orig).splitlines()[0]
            raise HTTPException(403 if code=='42501' else 409,CATALOG_MESSAGES.get(reason,'Catalog update rejected. Check your values and refresh the item.')) from None
        raise

@app.post('/api/v1/businesses/{business_id}/catalog')
def save_catalog(business_id:UUID,data:CatalogMutation,user_id:UUID=Depends(current_user)):
    permission='inventory.create' if data.operation=='stock.adjust' or data.item_id is None else 'inventory.edit'
    return catalog_write(business_id,user_id,lambda session:catalog_mutate(session,user_id,data),permission)

from cacu.accounting.workflows import ExpenseCreate,ReversalCreate,expense_accounts,expense_create,recent_documents,reversal_create

@app.get('/api/v1/businesses/{business_id}/expense-accounts')
def list_expense_accounts(business_id:UUID,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id) as session:
        return expense_accounts(session)

@app.get('/api/v1/businesses/{business_id}/expenses')
def list_expenses(business_id:UUID,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id) as session:
        return recent_documents(session,'expense')

@app.post('/api/v1/businesses/{business_id}/expenses')
def create_expense(business_id:UUID,data:ExpenseCreate,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='expenses.post') as session:
        return expense_create(session,user_id,data)

@app.get('/api/v1/businesses/{business_id}/journals')
def list_journals(business_id:UUID,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id) as session:
        return recent_documents(session,'adjustment')

@app.post('/api/v1/businesses/{business_id}/journals/{journal_id}/reversal')
def reverse_journal(business_id:UUID,journal_id:UUID,data:ReversalCreate,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='ledger.post') as session:
        return reversal_create(session,user_id,journal_id,data)

@app.post('/api/v1/businesses/{business_id}/expenses/{expense_id}/reversal')
def reverse_expense(business_id:UUID,expense_id:UUID,data:ReversalCreate,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='expenses.post') as session:
        return reversal_create(session,user_id,expense_id,data)

from cacu.accounting.stock import AdjustmentRequest,Decision,Policy,decide,list_adjustments,policy,request_adjustment,set_policy

@app.get('/api/v1/businesses/{business_id}/stock/adjustments')
def stock_adjustments(business_id:UUID,status:str|None=None,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id) as session:
        return list_adjustments(session,status,actor=user_id)

@app.post('/api/v1/businesses/{business_id}/stock/adjustments')
def request_stock_adjustment(business_id:UUID,data:AdjustmentRequest,user_id:UUID=Depends(current_user)):
    return catalog_write(business_id,user_id,lambda session:request_adjustment(session,user_id,data),'inventory.create')

@app.post('/api/v1/businesses/{business_id}/stock/adjustments/{adjustment_id}/approve')
def approve_stock_adjustment(business_id:UUID,adjustment_id:UUID,data:Decision,user_id:UUID=Depends(current_user)):
    return catalog_write(business_id,user_id,lambda session:decide(session,user_id,adjustment_id,True,data))

@app.post('/api/v1/businesses/{business_id}/stock/adjustments/{adjustment_id}/reject')
def reject_stock_adjustment(business_id:UUID,adjustment_id:UUID,data:Decision,user_id:UUID=Depends(current_user)):
    return catalog_write(business_id,user_id,lambda session:decide(session,user_id,adjustment_id,False,data))

@app.get('/api/v1/businesses/{business_id}/approval-policy')
def approval_policy(business_id:UUID,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id) as session:
        return policy(session)

@app.post('/api/v1/businesses/{business_id}/approval-policy')
def save_approval_policy(business_id:UUID,data:Policy,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True) as session:
        return set_policy(session,user_id,data)

from cacu.accounting.bills import BillCreate,SupplierPaymentCreate,bill_create,list_bills,payment_create

@app.get('/api/v1/businesses/{business_id}/supplier-bills')
def supplier_bills(business_id:UUID,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id) as session:
        return list_bills(session)

@app.post('/api/v1/businesses/{business_id}/supplier-bills')
def create_supplier_bill(business_id:UUID,data:BillCreate,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='expenses.post') as session:
        return bill_create(session,user_id,data)

@app.post('/api/v1/businesses/{business_id}/supplier-bills/{bill_id}/payments')
def pay_supplier_bill(business_id:UUID,bill_id:UUID,data:SupplierPaymentCreate,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='expenses.post') as session:
        return payment_create(session,user_id,bill_id,data)

from cacu.accounting.accounts import AccountCreate,account_create

ACCOUNT_MESSAGES={'DUPLICATE_ACCOUNT_NAME':'Another account already has that name.','CODE_RANGE_FULL':'There is no free code left for this kind of account.',
    'INVALID_ACCOUNT_KIND':'Choose what kind of account this is.','INVALID_NAME':'Enter a name of up to 100 characters.',
    'CHART_NOT_ADOPTED':'Set up the standard accounts first.','ACCESS_DENIED':'Only an Owner or Admin can change the chart of accounts.'}

@app.post('/api/v1/businesses/{business_id}/accounts')
def add_account(business_id:UUID,data:AccountCreate,user_id:UUID=Depends(current_user)):
    try:
        with library_transaction(user_id,business_id,write=True) as session:
            return account_create(session,user_id,data)
    except SQLAlchemyError as exc:
        code=getattr(exc.orig,'sqlstate',None);reason=str(getattr(exc,'orig',exc)).splitlines()[0]
        if code in {'P0001','22023','23505','23514','42501'}:
            raise HTTPException(403 if code=='42501' else 409,ACCOUNT_MESSAGES.get(reason,'The account was not added. Check the name and kind.')) from None
        raise


# IFRS valuation and reporting-close controls share the existing auth, tenant and transaction boundary.
from cacu.accounting.inventory import (InventoryPolicy,AdoptItem,GoodsReceipt,NrvAssessment,StockReturn,
    set_policy as inventory_policy_save,adopt as inventory_adopt,receipt as goods_receipt,
    assess_nrv,restore_return,overview as inventory_overview)
from cacu.accounting.cash_rules import CashClassification,save_classification
from cacu.accounting.close import CloseDraft,Approval,save_close,load_close,approve_close,list_closes,GAPS

@app.get('/api/v1/businesses/{business_id}/inventory/valuation')
def inventory_valuation_report(business_id:UUID,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id) as session:
        return inventory_overview(session)

@app.post('/api/v1/businesses/{business_id}/inventory/policy')
def approve_inventory_policy(business_id:UUID,data:InventoryPolicy,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True) as session:
        return inventory_policy_save(session,user_id,data)

@app.post('/api/v1/businesses/{business_id}/inventory/adopt')
def adopt_inventory_valuation(business_id:UUID,data:AdoptItem,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True) as session:
        return inventory_adopt(session,user_id,data)

@app.post('/api/v1/businesses/{business_id}/inventory/receipts')
def receive_inventory(business_id:UUID,data:GoodsReceipt,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True) as session:
        return goods_receipt(session,user_id,data)

@app.post('/api/v1/businesses/{business_id}/inventory/nrv')
def review_inventory_nrv(business_id:UUID,data:NrvAssessment,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True) as session:
        return assess_nrv(session,user_id,data)

@app.post('/api/v1/businesses/{business_id}/inventory/returns')
def return_inventory(business_id:UUID,data:StockReturn,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True) as session:
        return restore_return(session,user_id,data)

@app.post('/api/v1/businesses/{business_id}/cash-flow-classifications')
def classify_cash_flows(business_id:UUID,data:CashClassification,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True) as session:
        return save_classification(session,user_id,data)

@app.get('/api/v1/businesses/{business_id}/reporting-close')
def reporting_closes(business_id:UUID,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id) as session:
        accounts=session.connection().exec_driver_sql("SELECT m.account_id::text AS id,a.name,to_jsonb(a)->>'code' AS code,n.account_type::text AS type,m.flow_section FROM accounting.account_map m JOIN public.accounts a ON a.id=m.account_id AND a.business_id=m.business_id JOIN accounting.account n ON n.id=m.library_id AND n.business_id=m.business_id WHERE m.business_id=%s",(str(business_id),)).mappings().all()
        suppliers=session.connection().exec_driver_sql('SELECT id::text,name FROM public.suppliers WHERE business_id=%s ORDER BY name LIMIT 500',(str(business_id),)).mappings().all()
        policies=session.connection().exec_driver_sql('SELECT account_id::text,effective_from,nature,section,cash_eligible,restricted,evidence FROM accounting.cash_flow_classification WHERE business_id=%s ORDER BY effective_from DESC,account_id LIMIT 200',(str(business_id),)).mappings().all()
        return {'closes':list_closes(session),'checklist':GAPS,'accounts':[dict(r) for r in accounts],'suppliers':[dict(r) for r in suppliers],'cash_classifications':[dict(r) for r in policies]}

@app.post('/api/v1/businesses/{business_id}/reporting-close')
def submit_reporting_close(business_id:UUID,data:CloseDraft,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True) as session:
        return save_close(session,user_id,data)

@app.get('/api/v1/businesses/{business_id}/reporting-close/{close_id}')
def reporting_close_detail(business_id:UUID,close_id:UUID,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id) as session:
        return load_close(session,close_id)

@app.post('/api/v1/businesses/{business_id}/reporting-close/{close_id}/approve')
def approve_reporting_close(business_id:UUID,close_id:UUID,data:Approval,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True) as session:
        return approve_close(session,user_id,close_id,data)

from cacu.billing.routes import billing_router
app.include_router(billing_router(current_user))
