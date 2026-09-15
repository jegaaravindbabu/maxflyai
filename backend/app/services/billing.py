"""
Plans, usage metering, entitlements and quota. Payment-provider-agnostic
(see payments.py).

Metering unit = processing MINUTES (video duration transcribed). Paid plans
pool their minutes across the whole purchased period; Free resets each calendar
month. Access is time-boxed: a paid plan has a duration (day
pass 1 day, monthly 30 days, up to 1 year) and sets current_period_end; once
that passes the user falls back to Free automatically.

Product model: one free tier (restricted) and one full-access "Pro" toolkit
sold at five durations. Every paid plan unlocks the same entitlements — they
differ only in price and how long access lasts.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models import Subscription, UsageEvent

# every export format the pipeline can produce
ALL_FORMATS = ["srt", "vtt", "ass", "mp4", "fcpxml", "edl", "bundle"]

# Entitlement fields per plan:
#   minutes        processing minutes / calendar month
#   storage_gb     cloud storage cap
#   max_res        max export short-side resolution (px)
#   price_inr      one-off price for the plan's duration (INR)
#   duration_days  access length; None = free/forever
#   retention_days project auto-delete window (None = permanent)
#   watermark      burn "ceyonai" watermark into MP4 exports
#   formats        allowed export formats
#   translate      "preview" (edit only) or "full" (edit + export translated)
PLANS = {
    "free": {
        "label": "Free", "minutes": 15, "storage_gb": 1, "max_res": 720,
        "price_inr": 0, "duration_days": None, "retention_days": 7,
        "watermark": True, "formats": ["mp4"], "translate": "preview",
    },
    "day": {
        "label": "Day Pass", "minutes": 45, "storage_gb": 2, "max_res": 2160,
        "price_inr": 59, "duration_days": 1, "retention_days": 30,
        "watermark": False, "formats": ALL_FORMATS, "translate": "full",
    },
    "monthly": {
        "label": "Monthly", "minutes": 300, "storage_gb": 30, "max_res": 2160,
        "price_inr": 499, "duration_days": 30, "retention_days": None,
        "watermark": False, "formats": ALL_FORMATS, "translate": "full",
    },
    "q3": {
        "label": "3 Months", "minutes": 900, "storage_gb": 30, "max_res": 2160,
        "price_inr": 1199, "duration_days": 90, "retention_days": None,
        "watermark": False, "formats": ALL_FORMATS, "translate": "full",
    },
    "h6": {
        "label": "6 Months", "minutes": 1800, "storage_gb": 30, "max_res": 2160,
        "price_inr": 2199, "duration_days": 180, "retention_days": None,
        "watermark": False, "formats": ALL_FORMATS, "translate": "full",
    },
    "y1": {
        "label": "1 Year", "minutes": 3600, "storage_gb": 30, "max_res": 2160,
        "price_inr": 3999, "duration_days": 365, "retention_days": None,
        "watermark": False, "formats": ALL_FORMATS, "translate": "full",
    },
}
DEFAULT_PLAN = "free"


def plan_config(plan: str) -> dict:
    return PLANS.get(plan, PLANS[DEFAULT_PLAN])


def entitlements(plan: str) -> dict:
    cfg = plan_config(plan)
    return {
        "watermark": bool(cfg.get("watermark", False)),
        "max_res": int(cfg.get("max_res", 720)),
        "formats": list(cfg.get("formats", ALL_FORMATS)),
        "translate": cfg.get("translate", "full"),
    }


def _period_start(now: datetime | None = None) -> datetime:
    now = now or datetime.now(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _active_sub(db: Session, user_id: str) -> Subscription | None:
    """Most recent active subscription that has NOT expired. A paid plan whose
    current_period_end has passed is treated as inactive (user drops to Free)."""
    now = datetime.now(timezone.utc)
    subs = (db.query(Subscription)
              .filter(Subscription.user_id == user_id, Subscription.status == "active")
              .order_by(Subscription.created_at.desc()).all())
    for sub in subs:
        end = sub.current_period_end
        if end is not None and end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)
        if end is None or end > now:
            return sub
    return None


def current_plan(db: Session, user_id: str) -> str:
    sub = _active_sub(db, user_id)
    return sub.plan if sub else DEFAULT_PLAN


def _usage_window_start(db: Session, user_id: str) -> datetime:
    """Start of the window that usage is counted against. Paid plans pool their
    minutes across the whole purchased period (from the day they bought, so a
    6-month plan is one 1,800-minute pool, not 300 that resets monthly). Free has
    no purchase window, so it resets on the 1st of each calendar month."""
    sub = _active_sub(db, user_id)
    if sub and sub.current_period_start:
        st = sub.current_period_start
        if st.tzinfo is None:
            st = st.replace(tzinfo=timezone.utc)
        return st
    return _period_start()


def minutes_used(db: Session, user_id: str) -> int:
    start = _usage_window_start(db, user_id)
    rows = (db.query(UsageEvent)
              .filter(UsageEvent.user_id == user_id, UsageEvent.created_at >= start).all())
    return sum(r.minutes for r in rows)


def duration_to_minutes(duration_ms: int) -> int:
    return max(1, math.ceil((duration_ms or 0) / 60000))


def quota(db: Session, user_id: str) -> dict:
    plan = current_plan(db, user_id)
    cfg = plan_config(plan)
    ent = entitlements(plan)
    used = minutes_used(db, user_id)
    sub = _active_sub(db, user_id)
    end = sub.current_period_end if sub else None
    return {"plan": plan, "label": cfg["label"], "minutes_cap": cfg["minutes"],
            "minutes_used": used, "minutes_left": max(0, cfg["minutes"] - used),
            "max_res": cfg["max_res"], "storage_gb": cfg["storage_gb"],
            "watermark": ent["watermark"], "formats": ent["formats"],
            "translate": ent["translate"], "expires_at": end}


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
    # deactivate existing, add the new active subscription with a time-boxed
    # access window derived from the plan's duration.
    for sub in db.query(Subscription).filter(Subscription.user_id == user_id,
                                             Subscription.status == "active").all():
        sub.status = "canceled"
    now = datetime.now(timezone.utc)
    dur = plan_config(plan).get("duration_days")
    end = None if dur is None else now + timedelta(days=int(dur))
    sub = Subscription(user_id=user_id, plan=plan, status="active",
                       provider=provider, provider_sub_id=provider_sub_id,
                       current_period_start=now, current_period_end=end)
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return sub
