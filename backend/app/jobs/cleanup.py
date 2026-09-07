"""Delete rendered exports older than EXPORT_RETENTION_DAYS to keep storage bounded.

Run as a scheduled job (Render Cron):  python -m app.jobs.cleanup
Only regenerable EXPORT files are removed. Source uploads, projects, captions and
every other user asset are never touched — a user can always re-export.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.config import settings
from app.database import SessionLocal
from app.models import Export
from app.services.storage import storage


def _candidate_keys(project_id: str, fmt: str) -> list[str]:
    """Rebuild the deterministic storage keys an export could have used
    (with and without the '_clean' cut suffix)."""
    keys: list[str] = []
    for suf in ("", "_clean"):
        if fmt == "mp4":
            keys.append(f"exports/{project_id}{suf}_captioned.mp4")
        else:
            keys.append(f"exports/{project_id}{suf}.{fmt}")
            keys.append(f"exports/{project_id}{suf}_bundle.zip")
    return keys


def run(days: int | None = None) -> dict:
    days = settings.export_retention_days if days is None else days
    if not days or days < 1:
        print("[cleanup] retention disabled (export_retention_days < 1)")
        return {"rows": 0, "objects": 0}
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    db = SessionLocal()
    rows_deleted = objs_deleted = 0
    try:
        old = db.query(Export).filter(Export.created_at < cutoff).all()
        for e in old:
            for key in _candidate_keys(e.project_id, e.format):
                try:
                    if storage.delete(key):
                        objs_deleted += 1
                except Exception:
                    pass
            db.delete(e)
            rows_deleted += 1
        db.commit()
    finally:
        db.close()
    print(f"[cleanup] removed {rows_deleted} export rows and {objs_deleted} "
          f"storage objects older than {days} day(s)")
    return {"rows": rows_deleted, "objects": objs_deleted}


if __name__ == "__main__":
    run()
