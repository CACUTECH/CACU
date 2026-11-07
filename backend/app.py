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
    with library_transaction(user_id,business_id,permission='ledger.view') as session:
        return cash_flow(session,start_date,end_date)

@app.get('/api/v1/businesses/{business_id}/reports/summary')
def accounting_summary(business_id: UUID,start_date:date,end_date:date,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,permission='ledger.view') as session:
        return financial_summary(session,start_date,end_date)

@app.get('/api/v1/businesses/{business_id}/reports/trial-balance')
def trial_balance_report(business_id:UUID,as_of:date,user_id:UUID=Depends(current_user)):
    from cacu.accounting.reports import trial_balance
    with library_transaction(user_id,business_id,permission='ledger.view') as session:
        return trial_balance(session,as_of)

@app.get('/api/v1/businesses/{business_id}/reports/statements')
def financial_statements(business_id:UUID,start_date:date,end_date:date,compare:str|None=None,user_id:UUID=Depends(current_user)):
    from cacu.accounting.reports import statements
    with library_transaction(user_id,business_id,permission='ledger.view') as session:
        return statements(session,start_date,end_date,compare)

@app.get('/api/v1/businesses/{business_id}/reports/general-ledger')
def general_ledger_report(business_id:UUID,account_id:UUID,start_date:date,end_date:date,page:int=0,user_id:UUID=Depends(current_user)):
    from cacu.accounting.reports import general_ledger
    with library_transaction(user_id,business_id,permission='ledger.view') as session:
        return general_ledger(session,account_id,start_date,end_date,page)

from cacu.accounting.posting import PostingCommand,post_command

# Doc 08 permission each posting kind needs. Corrections (reversal, credit note) are also Owner/Admin-only in post_command.
POSTING_PERMISSIONS={'invoice':'invoices.post','receipt':'invoices.post','credit_note':'invoices.post','pos':'sales.post',
    'expense':'expenses.post','bill':'expenses.post','supplier_payment':'expenses.post','adjustment':'ledger.post',
    'reversal':'ledger.post','transfer':'banking.post'}

@app.post('/api/v1/businesses/{business_id}/postings')
def accounting_posting(business_id:UUID,command:PostingCommand,user_id:UUID=Depends(current_user)):
    # Collecting what customers already owe stays open while the subscription is suspended (SUB-10).
    with library_transaction(user_id,business_id,write=True,while_read_only=command.kind=='receipt',permission=POSTING_PERMISSIONS.get(command.kind,'ledger.post')) as session:
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
    with library_transaction(user_id,business_id,permission='invoices.view') as session:
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
    with library_transaction(user_id,business_id,permission='expenses.view') as session:
        return expense_accounts(session)

@app.get('/api/v1/businesses/{business_id}/expenses')
def list_expenses(business_id:UUID,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,permission='expenses.view') as session:
        return recent_documents(session,'expense')

@app.post('/api/v1/businesses/{business_id}/expenses')
def create_expense(business_id:UUID,data:ExpenseCreate,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='expenses.post') as session:
        return expense_create(session,user_id,data)

@app.get('/api/v1/businesses/{business_id}/journals')
def list_journals(business_id:UUID,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,permission='ledger.view') as session:
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
    with library_transaction(user_id,business_id,permission='inventory.view') as session:
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
    with library_transaction(user_id,business_id,permission='inventory.view') as session:
        return policy(session)

@app.post('/api/v1/businesses/{business_id}/approval-policy')
def save_approval_policy(business_id:UUID,data:Policy,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='settings.edit') as session:
        return set_policy(session,user_id,data)

from cacu.accounting.bills import BillCreate,SupplierPaymentCreate,bill_create,list_bills,payment_create

@app.get('/api/v1/businesses/{business_id}/supplier-bills')
def supplier_bills(business_id:UUID,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,permission='expenses.view') as session:
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
        with library_transaction(user_id,business_id,write=True,permission='ledger.edit') as session:
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
    with library_transaction(user_id,business_id,permission='inventory.view') as session:
        return inventory_overview(session)

@app.post('/api/v1/businesses/{business_id}/inventory/policy')
def approve_inventory_policy(business_id:UUID,data:InventoryPolicy,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='inventory.approve') as session:
        return inventory_policy_save(session,user_id,data)

@app.post('/api/v1/businesses/{business_id}/inventory/adopt')
def adopt_inventory_valuation(business_id:UUID,data:AdoptItem,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='inventory.approve') as session:
        return inventory_adopt(session,user_id,data)

@app.post('/api/v1/businesses/{business_id}/inventory/receipts')
def receive_inventory(business_id:UUID,data:GoodsReceipt,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='inventory.post') as session:
        return goods_receipt(session,user_id,data)

@app.post('/api/v1/businesses/{business_id}/inventory/nrv')
def review_inventory_nrv(business_id:UUID,data:NrvAssessment,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='inventory.approve') as session:
        return assess_nrv(session,user_id,data)

@app.post('/api/v1/businesses/{business_id}/inventory/returns')
def return_inventory(business_id:UUID,data:StockReturn,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='inventory.post') as session:
        return restore_return(session,user_id,data)

@app.post('/api/v1/businesses/{business_id}/cash-flow-classifications')
def classify_cash_flows(business_id:UUID,data:CashClassification,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='ledger.edit') as session:
        return save_classification(session,user_id,data)

@app.get('/api/v1/businesses/{business_id}/reporting-close')
def reporting_closes(business_id:UUID,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,permission='ledger.view') as session:
        accounts=session.connection().exec_driver_sql("SELECT m.account_id::text AS id,a.name,to_jsonb(a)->>'code' AS code,n.account_type::text AS type,m.flow_section FROM accounting.account_map m JOIN public.accounts a ON a.id=m.account_id AND a.business_id=m.business_id JOIN accounting.account n ON n.id=m.library_id AND n.business_id=m.business_id WHERE m.business_id=%s",(str(business_id),)).mappings().all()
        suppliers=session.connection().exec_driver_sql('SELECT id::text,name FROM public.suppliers WHERE business_id=%s ORDER BY name LIMIT 500',(str(business_id),)).mappings().all()
        policies=session.connection().exec_driver_sql('SELECT account_id::text,effective_from,nature,section,cash_eligible,restricted,evidence FROM accounting.cash_flow_classification WHERE business_id=%s ORDER BY effective_from DESC,account_id LIMIT 200',(str(business_id),)).mappings().all()
        return {'closes':list_closes(session),'checklist':GAPS,'accounts':[dict(r) for r in accounts],'suppliers':[dict(r) for r in suppliers],'cash_classifications':[dict(r) for r in policies]}

@app.post('/api/v1/businesses/{business_id}/reporting-close')
def submit_reporting_close(business_id:UUID,data:CloseDraft,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='ledger.create') as session:
        return save_close(session,user_id,data)

@app.get('/api/v1/businesses/{business_id}/reporting-close/{close_id}')
def reporting_close_detail(business_id:UUID,close_id:UUID,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,permission='ledger.view') as session:
        return load_close(session,close_id)

@app.post('/api/v1/businesses/{business_id}/reporting-close/{close_id}/approve')
def approve_reporting_close(business_id:UUID,close_id:UUID,data:Approval,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='ledger.approve') as session:
        return approve_close(session,user_id,close_id,data)

from cacu.billing.routes import billing_router
app.include_router(billing_router(current_user))

# Transfers awaiting confirmation and the owner's daily reconciliation (BR-010, Doc 10, Doc 11 R1 transfer endpoints).
from cacu.accounting.transfers import TransferConfirm,TransferNotReceived,confirm as confirm_transfer,not_received as transfer_not_received,list_transfers,daily as daily_reconciliation

@app.get('/api/v1/businesses/{business_id}/transfers')
def pending_transfers(business_id:UUID,status:str='pending',user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,permission='banking.view') as session:
        return list_transfers(session,status)

@app.post('/api/v1/businesses/{business_id}/transfers/{transfer_id}/confirm')
def confirm_pending_transfer(business_id:UUID,transfer_id:UUID,data:TransferConfirm,user_id:UUID=Depends(current_user)):
    # Recording money that arrived is allowed while the workspace is read-only, like receipts.
    with library_transaction(user_id,business_id,write=True,while_read_only=True,permission='banking.post') as session:
        return confirm_transfer(session,user_id,transfer_id,data)

@app.post('/api/v1/businesses/{business_id}/transfers/{transfer_id}/not-received')
def reject_pending_transfer(business_id:UUID,transfer_id:UUID,data:TransferNotReceived,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='banking.post') as session:
        return transfer_not_received(session,user_id,transfer_id,data)

@app.get('/api/v1/businesses/{business_id}/reconciliation/daily')
def daily_reconciliation_report(business_id:UUID,day:date,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,permission='banking.view') as session:
        return daily_reconciliation(session,day,user_id)

# POS checkout settings, shortfalls and receipts (Doc 10, BR-022).
from cacu.accounting.checkout import SalesPolicy,options as checkout_options,save_policy as save_sales_policy,shortfalls as stock_shortfalls,review_shortfall,receipt as sale_receipt

@app.get('/api/v1/businesses/{business_id}/sales/options')
def sales_options(business_id:UUID,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,permission='sales.view') as session:
        return checkout_options(session)

@app.post('/api/v1/businesses/{business_id}/sales/policy')
def save_sales_options(business_id:UUID,data:SalesPolicy,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='settings.edit') as session:
        return save_sales_policy(session,user_id,data)

@app.get('/api/v1/businesses/{business_id}/sales/{sale_id}/receipt')
def sales_receipt(business_id:UUID,sale_id:UUID,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,permission='sales.view') as session:
        return sale_receipt(session,sale_id)

@app.get('/api/v1/businesses/{business_id}/stock/shortfalls')
def list_stock_shortfalls(business_id:UUID,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,permission='inventory.view') as session:
        return stock_shortfalls(session)

@app.post('/api/v1/businesses/{business_id}/stock/shortfalls/{sale_id}/{item_id}/review')
def review_stock_shortfall(business_id:UUID,sale_id:UUID,item_id:UUID,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='inventory.approve') as session:
        return review_shortfall(session,user_id,sale_id,item_id)

# Refunds (Doc 10, PR-16, FR-044) and the day's till sales they start from.
from cacu.accounting.refunds import (RefundDecision,RefundPolicy,RefundRequest,decide as decide_refund,list_refunds,refundable,
    request as request_refund,sales_on,save_refund_policy)

@app.get('/api/v1/businesses/{business_id}/sales')
def list_sales(business_id:UUID,day:date,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,permission='sales.view') as session:
        return sales_on(session,day)

@app.post('/api/v1/businesses/{business_id}/sales/refund-policy')
def save_sales_refund_policy(business_id:UUID,data:RefundPolicy,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='settings.edit') as session:
        return save_refund_policy(session,user_id,data)

@app.get('/api/v1/businesses/{business_id}/sales/{sale_id}/refundable')
def sale_refundable(business_id:UUID,sale_id:UUID,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,permission='sales.view') as session:
        return refundable(session,sale_id)

@app.post('/api/v1/businesses/{business_id}/sales/{sale_id}/refunds')
def create_refund(business_id:UUID,sale_id:UUID,data:RefundRequest,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='sales.edit') as session:
        return request_refund(session,user_id,sale_id,data)

@app.get('/api/v1/businesses/{business_id}/refunds')
def sale_refunds(business_id:UUID,status:str='pending',user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,permission='sales.view') as session:
        return list_refunds(session,status,user_id)

@app.post('/api/v1/businesses/{business_id}/refunds/{refund_id}/approve')
def approve_refund(business_id:UUID,refund_id:UUID,data:RefundDecision,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='sales.approve') as session:
        return decide_refund(session,user_id,refund_id,True,data)

@app.post('/api/v1/businesses/{business_id}/refunds/{refund_id}/reject')
def reject_refund(business_id:UUID,refund_id:UUID,data:RefundDecision,user_id:UUID=Depends(current_user)):
    # The requester may withdraw their own request (sales.edit); rejecting anyone else's needs sales.approve, checked inside.
    with library_transaction(user_id,business_id,write=True,permission='sales.edit') as session:
        return decide_refund(session,user_id,refund_id,False,data)

# Cashier shifts (Doc 10 shifts, Doc 09 PR-22, Doc 11 /shifts), on the Oga and Chairman plans.
from cacu.accounting.shifts import (CashMovement,ShiftClose,ShiftOpen,ShiftPolicy,close as close_shift,current as current_shift,
    list_shifts,move as shift_movement,save_shift_policy,start as open_shift)

@app.get('/api/v1/businesses/{business_id}/shifts/current')
def my_shift(business_id:UUID,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,permission='sales.view') as session:
        return current_shift(session,user_id)

@app.get('/api/v1/businesses/{business_id}/shifts')
def shifts(business_id:UUID,day:date|None=None,status:str|None=None,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,permission='sales.view') as session:
        return list_shifts(session,user_id,day,status)

@app.post('/api/v1/businesses/{business_id}/shifts')
def start_shift(business_id:UUID,data:ShiftOpen,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='sales.post') as session:
        return open_shift(session,user_id,data)

@app.post('/api/v1/businesses/{business_id}/shifts/policy')
def save_shifts_policy(business_id:UUID,data:ShiftPolicy,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='settings.edit') as session:
        return save_shift_policy(session,user_id,data)

@app.post('/api/v1/businesses/{business_id}/shifts/{shift_id}/movements')
def shift_cash_movement(business_id:UUID,shift_id:UUID,data:CashMovement,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='sales.post') as session:
        return shift_movement(session,user_id,shift_id,data)

@app.post('/api/v1/businesses/{business_id}/shifts/{shift_id}/close')
def close_till_shift(business_id:UUID,shift_id:UUID,data:ShiftClose,user_id:UUID=Depends(current_user)):
    # The cashier closes their own shift (sales.post); closing someone else's needs sales.approve, checked inside.
    with library_transaction(user_id,business_id,write=True,permission='sales.post') as session:
        return close_shift(session,user_id,shift_id,data)

# Booking deposits (Doc 10 services rules, Doc 09 PR-12), bookings part 2.
from cacu.accounting.bookings import (BookingClose,BookingSettings,DepositTake,cancel as cancel_booking,deposits_between,no_show as booking_no_show,
    save_settings as save_booking_settings,settings as booking_settings,take as take_deposit)

@app.get('/api/v1/businesses/{business_id}/bookings/settings')
def get_booking_settings(business_id:UUID,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,permission='services.view') as session:
        return booking_settings(session)

@app.post('/api/v1/businesses/{business_id}/bookings/settings')
def save_bookings_settings(business_id:UUID,data:BookingSettings,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='settings.edit') as session:
        return save_booking_settings(session,user_id,data)

@app.get('/api/v1/businesses/{business_id}/bookings/deposits')
def booking_deposits(business_id:UUID,start:date,end:date,user_id:UUID=Depends(current_user)):
    if (end-start).days>62:raise HTTPException(422,'Choose at most two months')
    with library_transaction(user_id,business_id,permission='services.view') as session:
        return deposits_between(session,start,end)

@app.post('/api/v1/businesses/{business_id}/bookings/{appointment_id}/deposit')
def booking_deposit(business_id:UUID,appointment_id:UUID,data:DepositTake,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='sales.post') as session:
        return take_deposit(session,user_id,appointment_id,data)

@app.post('/api/v1/businesses/{business_id}/bookings/{appointment_id}/cancel')
def booking_cancel(business_id:UUID,appointment_id:UUID,data:BookingClose,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='services.edit') as session:
        return cancel_booking(session,user_id,appointment_id,data)

@app.post('/api/v1/businesses/{business_id}/bookings/{appointment_id}/no-show')
def booking_mark_no_show(business_id:UUID,appointment_id:UUID,data:BookingClose,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='services.edit') as session:
        return booking_no_show(session,user_id,appointment_id,data)

# Billing a completed booking (bookings part 3, PR-13 and PR-11): the till uses POST /sales with booking_id.
from cacu.accounting.bookings import BookingInvoice,bill_info as booking_bill_info,bill_invoice as booking_bill_invoice

@app.get('/api/v1/businesses/{business_id}/bookings/{appointment_id}/bill')
def booking_bill(business_id:UUID,appointment_id:UUID,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,permission='services.view') as session:
        return booking_bill_info(session,appointment_id)

@app.post('/api/v1/businesses/{business_id}/bookings/{appointment_id}/invoice')
def booking_invoice(business_id:UUID,appointment_id:UUID,data:BookingInvoice,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='invoices.post') as session:
        return booking_bill_invoice(session,user_id,appointment_id,data)

# Jobs (Doc 10 services rules), bookings part 4: completion issues materials; the till bills with POST /sales job_id.
from cacu.accounting.jobs import (CostRates,JobComplete,JobInvoice,bill_invoice as job_bill_invoice,complete as complete_job,cost_rates as job_cost_rates,
    detail as job_detail,save_cost_rates as save_job_cost_rates)

@app.get('/api/v1/businesses/{business_id}/jobs/cost-rates')
def get_job_cost_rates(business_id:UUID,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,permission='ledger.view') as session:
        return job_cost_rates(session)

@app.post('/api/v1/businesses/{business_id}/jobs/cost-rates')
def save_jobs_cost_rates(business_id:UUID,data:CostRates,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='settings.edit') as session:
        return save_job_cost_rates(session,user_id,data)

@app.get('/api/v1/businesses/{business_id}/jobs/{job_id}')
def get_job(business_id:UUID,job_id:UUID,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,permission='services.view') as session:
        return job_detail(session,user_id,job_id)

@app.post('/api/v1/businesses/{business_id}/jobs/{job_id}/complete')
def finish_job(business_id:UUID,job_id:UUID,data:JobComplete,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='services.edit') as session:
        return complete_job(session,user_id,job_id,data)

@app.post('/api/v1/businesses/{business_id}/jobs/{job_id}/invoice')
def invoice_job(business_id:UUID,job_id:UUID,data:JobInvoice,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='invoices.post') as session:
        return job_bill_invoice(session,user_id,job_id,data)

# Purchasing part 2 (Doc 10 purchase-to-payment, PR-18): goods received against an order or on their own, and returns.
from cacu.accounting.purchasing import (GoodsReceive,SupplierReturn,detail as receipt_detail,list_receipts,receive as receive_goods,
    return_goods)

@app.get('/api/v1/businesses/{business_id}/goods-receipts')
def goods_receipts(business_id:UUID,order_id:UUID|None=None,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,permission='inventory.view') as session:
        return list_receipts(session,order_id)

@app.post('/api/v1/businesses/{business_id}/goods-receipts')
def create_goods_receipt(business_id:UUID,data:GoodsReceive,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='inventory.post') as session:
        return receive_goods(session,user_id,data)

@app.get('/api/v1/businesses/{business_id}/goods-receipts/{receipt_id}')
def goods_receipt(business_id:UUID,receipt_id:UUID,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,permission='inventory.view') as session:
        return receipt_detail(session,receipt_id)

@app.post('/api/v1/businesses/{business_id}/goods-receipts/{receipt_id}/returns')
def return_to_supplier(business_id:UUID,receipt_id:UUID,data:SupplierReturn,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='inventory.post') as session:
        return return_goods(session,user_id,receipt_id,data)


# Purchasing part 3: the supplier's bill for received goods (Dr Goods received not invoiced, Cr Payables; IAS 2 differences).
from cacu.accounting.purchasing import GoodsBill,bill_received

@app.post('/api/v1/businesses/{business_id}/goods-receipts/bills')
def bill_received_goods(business_id:UUID,data:GoodsBill,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='expenses.post') as session:
        return bill_received(session,user_id,data)

# Purchasing part 4a: stock per outlet.
from cacu.accounting import outlets as outlet_stock

@app.get('/api/v1/businesses/{business_id}/outlets')
def business_outlets(business_id:UUID,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,permission='inventory.view') as session:
        return {'outlets':outlet_stock.listed(session),'own':outlet_stock.assigned(session,user_id)}

@app.get('/api/v1/businesses/{business_id}/outlet-stock')
def stock_by_outlet(business_id:UUID,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,permission='inventory.view') as session:
        return outlet_stock.stock(session)

# Purchasing part 4b: transfers between outlets (send, then receive; a shortfall on arrival is a loss).
from typing import Literal
from cacu.accounting.stock_transfers import TransferReceive,TransferSend,detail as transfer_detail,list_transfers,receive as receive_transfer,send as send_transfer

@app.get('/api/v1/businesses/{business_id}/stock-transfers')
def stock_transfers(business_id:UUID,status:Literal['in_transit','received']|None=None,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,permission='inventory.view') as session:
        return list_transfers(session,status)

@app.post('/api/v1/businesses/{business_id}/stock-transfers')
def create_stock_transfer(business_id:UUID,data:TransferSend,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='inventory.post') as session:
        return send_transfer(session,user_id,data)

@app.get('/api/v1/businesses/{business_id}/stock-transfers/{transfer_id}')
def stock_transfer(business_id:UUID,transfer_id:UUID,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,permission='inventory.view') as session:
        return transfer_detail(session,transfer_id)

@app.post('/api/v1/businesses/{business_id}/stock-transfers/{transfer_id}/receive')
def receive_stock_transfer(business_id:UUID,transfer_id:UUID,data:TransferReceive,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True,permission='inventory.post') as session:
        return receive_transfer(session,user_id,transfer_id,data)
