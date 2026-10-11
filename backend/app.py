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
        messages, size = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            size += len(message.get("body", b""))
            if size > self.max_bytes:
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

from cacu.accounting.posting import PostingCommand,post_command

@app.post('/api/v1/businesses/{business_id}/postings')
def accounting_posting(business_id:UUID,command:PostingCommand,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True) as session:
        return post_command(session,user_id,command)

from cacu.accounting.workflows import InvoiceCreate,ReceiptCreate,SaleCreate,invoice_create,receipt_create,sale_create

@app.post('/api/v1/businesses/{business_id}/invoices')
def create_invoice(business_id:UUID,data:InvoiceCreate,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True) as session:
        return invoice_create(session,user_id,data)

@app.post('/api/v1/businesses/{business_id}/receipts')
def create_receipt(business_id:UUID,data:ReceiptCreate,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True) as session:
        return receipt_create(session,user_id,data)

@app.post('/api/v1/businesses/{business_id}/sales')
def create_sale(business_id:UUID,data:SaleCreate,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True) as session:
        return sale_create(session,user_id,data)

from python_accounting.exceptions import AccountingExeption

@app.exception_handler(AccountingExeption)
async def accounting_rule_error(request,exc):
    return JSONResponse(status_code=409,content={'detail':'Accounting period, account classification or allocation rule rejected this operation'})

class JournalPosting(JournalDraft):
    request_key: UUID

@app.post('/api/v1/businesses/{business_id}/journals')
def post_balanced_journal(business_id:UUID,draft:JournalPosting,user_id:UUID=Depends(current_user)):
    with library_transaction(user_id,business_id,write=True) as session:
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
