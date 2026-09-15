"""Billing: plans, current usage, checkout (mock or Razorpay), webhook."""
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.services import billing, payments
from app.services.auth import require_user
from app.config import settings

router = APIRouter(prefix="/api/billing", tags=["billing"])


class CheckoutRequest(BaseModel):
    plan: str


class VerifyRequest(BaseModel):
    order_id: str
    payment_id: str
    signature: str


@router.get("/plans")
def plans():
    return {"plans": [{"id": k, **v} for k, v in billing.PLANS.items()],
            "payments_live": payments.get_provider().name == "razorpay"}


@router.get("/me")
def me(db: Session = Depends(get_db), user: str = Depends(require_user)):
    q = billing.quota(db, user)
    prov = payments.get_provider().name
    return {**q, "provider": prov}


@router.post("/checkout")
def checkout(body: CheckoutRequest, db: Session = Depends(get_db),
             user: str = Depends(require_user)):
    if body.plan not in billing.PLANS:
        raise HTTPException(400, "unknown plan")
    if body.plan == "free":
        billing.set_plan(db, user, "free", provider="mock")
        return {"mode": "mock", "status": "activated", "plan": "free"}
    prov = payments.get_provider()
    # Safety: in a live deploy (auth on) never fall back to the mock provider,
    # which would activate a paid plan for free with no payment. Surface a clear
    # error instead so the misconfiguration is visible, not a free upgrade.
    if prov.name == "mock" and settings.auth_enabled:
        raise HTTPException(503, detail={
            "error": "payments_unconfigured",
            "message": "Payments aren\u2019t set up yet. Please try again shortly."})
    return prov.create_checkout(db, user, body.plan)


@router.post("/verify")
def verify(body: VerifyRequest, db: Session = Depends(get_db),
           user: str = Depends(require_user)):
    """Instant activation from Razorpay Checkout's success callback. Verifies the
    payment signature, then reads the plan/user from the trusted order notes (not
    the client) before activating, so the plan can't be spoofed. The webhook
    remains the backup source of truth."""
    prov = payments.get_provider()
    if not prov.verify_payment(body.order_id, body.payment_id, body.signature):
        raise HTTPException(400, "invalid payment signature")
    order = prov.fetch_order(body.order_id)
    notes = order.get("notes", {}) or {}
    plan, uid = notes.get("plan"), notes.get("user_id")
    if not plan or uid != user:
        raise HTTPException(400, "order does not match this user")
    billing.set_plan(db, user, plan, provider="razorpay", provider_sub_id=body.payment_id)
    return {"status": "activated", "plan": plan}


@router.post("/webhook")
async def webhook(request: Request, db: Session = Depends(get_db)):
    body = await request.body()
    sig = request.headers.get("x-razorpay-signature", "")
    prov = payments.get_provider()
    if not prov.verify_webhook(body, sig):
        raise HTTPException(400, "invalid signature")
    event = json.loads(body or b"{}")
    # activate the plan on successful payment
    if event.get("event") in ("order.paid", "payment.captured", "subscription.activated"):
        entity = (event.get("payload", {}).get("order", {}).get("entity")
                  or event.get("payload", {}).get("payment", {}).get("entity") or {})
        notes = entity.get("notes", {}) or {}
        uid, plan = notes.get("user_id"), notes.get("plan")
        if uid and plan:
            billing.set_plan(db, uid, plan, provider="razorpay", provider_sub_id=entity.get("id"))
    return {"ok": True}
