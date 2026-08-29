"""
Plans, usage metering and quota. Payment-provider-agnostic (see payments.py).

Metering unit = processing MINUTES (video duration transcribed). Enforced per
calendar-month window. No subscription row => the free plan.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import Subscription, UsageEvent

# minutes/month, storage GB, max resolution, monthly price (INR, placeholders).
PLANS = {
    "free":    {"label": "Free",    "minutes": 5,   "storage_gb": 5,   "max_res": 720,  "price_inr": 0,    "retention_days": 7},
    "starter": {"label": "Starter", "minutes": 25,  "storage_gb": 10,  "max_res": 1080, "price_inr": 499},
    "creator": {"label": "Creator", "minutes": 80,  "storage_gb": 30,  "max_res": 2160, "price_inr": 1299},
    "pro":     {"label": "Pro",     "minutes": 250, "storage_gb": 100, "max_res": 2160, "price_inr": 2999},
}
DEFAULT_PLAN = "free"


def plan_config(plan: str) -> dict:
    return PLANS.get(plan, PLANS[DEFAULT_PLAN])


def _period_start(now: datetime | None = None) -> datetime:
    now = now or datetime.now(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def current_plan(db: Session, user_id: str) -> str:
    sub = (db.query(Subscription)
             .filter(Subscription.user_id == user_id, Subscription.status == "active")
             .order_by(Subscription.created_at.desc()).first())
    return sub.plan if sub else DEFAULT_PLAN


def minutes_used(db: Session, user_id: str) -> int:
    start = _period_start()
    rows = (db.query(UsageEvent)
              .filter(UsageEvent.user_id == user_id, UsageEvent.created_at >= start).all())
    return sum(r.minutes for r in rows)


def duration_to_minutes(duration_ms: int) -> int:
    return max(1, math.ceil((duration_ms or 0) / 60000))


def quota(db: Session, user_id: str) -> dict:
    plan = current_plan(db, user_id)
    cfg = plan_config(plan)
    used = minutes_used(db, user_id)
    return {"plan": plan, "label": cfg["label"], "minutes_cap": cfg["minutes"],
            "minutes_used": used, "minutes_left": max(0, cfg["minutes"] - used),
            "max_res": cfg["max_res"], "storage_gb": cfg["storage_gb"]}


def can_process(db: Session, user_id: str, duration_ms: int) -> tuple[bool, dict]:
    q = quota(db, user_id)
    need = duration_to_minutes(duration_ms)
    ok = q["minutes_used"] + need <= q["minutes_cap"]
    return ok, {**q, "minutes_needed": need}


def record_usage(db: Session, user_id: str, project_id: str, duration_ms: int,
                 kind: str = "transcription") -> None:
    db.add(UsageEvent(user_id=user_id, project_id=project_id,
                      minutes=duration_to_minutes(duration_ms), kind=kind))
    db.commit()


def set_plan(db: Session, user_id: str, plan: str, provider: str = "mock",
             provider_sub_id: str | None = None) -> Subscription:
    # deactivate existing, add the new active subscription
    for sub in db.query(Subscription).filter(Subscription.user_id == user_id,
                                             Subscription.status == "active").all():
        sub.status = "canceled"
    sub = Subscription(user_id=user_id, plan=plan, status="active",
                       provider=provider, provider_sub_id=provider_sub_id)
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return sub
