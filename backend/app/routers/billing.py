"""Billing: plans, current usage, checkout (mock or Razorpay), webhook."""
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.services import billing, payments
from app.services.auth import require_user

router = APIRouter(prefix="/api/billing", tags=["billing"])


class CheckoutRequest(BaseModel):
    plan: str


@router.get("/plans")
def plans():
    return {"plans": [{"id": k, **v} for k, v in billing.PLANS.items()]}


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
    return payments.get_provider().create_checkout(db, user, body.plan)


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
