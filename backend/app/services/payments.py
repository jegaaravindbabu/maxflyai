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

    def verify_payment(self, order_id: str, payment_id: str, signature: str) -> bool:
        return True

    def fetch_order(self, order_id: str) -> dict:
        return {}


class RazorpayProvider:
    name = "razorpay"
    API = "https://api.razorpay.com/v1"

    def create_checkout(self, db: Session, user_id: str, plan: str) -> dict:
        amount = billing.checkout_amount_paise(plan)  # base + 18% GST, paise
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
                "key_id": settings.razorpay_key_id, **billing.price_breakdown(plan)}

    def verify_payment(self, order_id: str, payment_id: str, signature: str) -> bool:
        """Verify Razorpay Checkout success signature: HMAC(order_id|payment_id)."""
        secret = settings.razorpay_key_secret.encode()
        msg = f"{order_id}|{payment_id}".encode()
        expected = hmac.new(secret, msg, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature or "")

    def fetch_order(self, order_id: str) -> dict:
        with httpx.Client(timeout=30, auth=(settings.razorpay_key_id, settings.razorpay_key_secret)) as c:
            r = c.get(f"{self.API}/orders/{order_id}")
        if r.status_code >= 400:
            raise RuntimeError(f"razorpay order fetch failed {r.status_code}: {r.text[:200]}")
        return r.json()

    def verify_webhook(self, body: bytes, signature: str) -> bool:
        secret = settings.razorpay_webhook_secret.encode()
        expected = hmac.new(secret, body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature or "")


def get_provider():
    if settings.razorpay_key_id and settings.razorpay_key_secret:
        return RazorpayProvider()
    return MockProvider()
