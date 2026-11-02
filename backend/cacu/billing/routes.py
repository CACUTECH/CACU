from uuid import UUID
from fastapi import APIRouter, Depends, Header, Request
from starlette.concurrency import run_in_threadpool
from .service import Checkout, Verification, checkout, verify_return, webhook


def billing_router(current_user):
    router = APIRouter(tags=['billing'])

    @router.post('/api/v1/businesses/{business_id}/billing/checkout')
    def open_checkout(business_id: UUID, data: Checkout, user_id: UUID = Depends(current_user)):
        return checkout(business_id, user_id, data)

    @router.post('/api/v1/businesses/{business_id}/billing/verify')
    def verify_payment(business_id: UUID, data: Verification, user_id: UUID = Depends(current_user)):
        return verify_return(business_id, user_id, data)

    # Signed by Paystack, not by a user: the HMAC over the raw body is the authentication.
    @router.post('/api/v1/webhooks/paystack')
    async def paystack_webhook(request: Request, signature: str | None = Header(default=None, alias='x-paystack-signature')):
        raw = await request.body()
        return await run_in_threadpool(webhook, raw, signature)

    return router
