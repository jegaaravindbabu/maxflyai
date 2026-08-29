"""
Payment provider abstraction. Works WITHOUT a Razorpay key via MockProvider
(dev/testing: upgrade activates instantly). When RAZORPAY_KEY_ID/SECRET are set,
RazorpayProvider creates real orders and activation happens via webhook.
"""
from __future__ import annotations

import hashlib
import hmac

import httpx
from sqlalchemy.orm import Session

from app.config import settings
from app.services import billing


class MockProvider:
    name = "mock"

    def create_checkout(self, db: Session, user_id: str, plan: str) -> dict:
        # no real payment — activate immediately so the flow is testable
        sub = billing.set_plan(db, user_id, plan, provider="mock")
        return {"mode": "mock", "status": "activated", "plan": plan,
                "subscription_id": sub.id,
                "message": "Mock payment — plan activated. Add a Razorpay key for real checkout."}

    def verify_webhook(self, body: bytes, signature: str) -> bool:
        return True


class RazorpayProvider:
    name = "razorpay"
    API = "https://api.razorpay.com/v1"

    def create_checkout(self, db: Session, user_id: str, plan: str) -> dict:
        cfg = billing.plan_config(plan)
        amount = cfg["price_inr"] * 100  # paise
        with httpx.Client(timeout=30, auth=(settings.razorpay_key_id, settings.razorpay_key_secret)) as c:
            r = c.post(f"{self.API}/orders", json={
                "amount": amount, "currency": "INR",
                "notes": {"user_id": user_id, "plan": plan}})
        if r.status_code >= 400:
            raise RuntimeError(f"razorpay order failed {r.status_code}: {r.text[:200]}")
        order = r.json()
        # frontend opens Razorpay Checkout with these; activation via webhook
        return {"mode": "razorpay", "status": "created", "plan": plan,
                "order_id": order["id"], "amount": amount, "currency": "INR",
                "key_id": settings.razorpay_key_id}

    def verify_webhook(self, body: bytes, signature: str) -> bool:
        secret = settings.razorpay_webhook_secret.encode()
        expected = hmac.new(secret, body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature or "")


def get_provider():
    if settings.razorpay_key_id and settings.razorpay_key_secret:
        return RazorpayProvider()
    return MockProvider()
