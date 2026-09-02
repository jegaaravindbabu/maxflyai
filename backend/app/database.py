"""SQLAlchemy engine + session. SQLite for dev, Postgres/Supabase for prod."""
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings

connect_args = {}
if settings.database_url.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(settings.database_url, connect_args=connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    # Import models so they register on Base before create_all.
    from app import models  # noqa: F401
    Base.metadata.create_all(bind=engine)
    # Lightweight, idempotent column adds for tables that predate a column
    # (create_all never ALTERs existing tables).
    from sqlalchemy import text
    _add_cols = [
        "ALTER TABLE exports ADD COLUMN IF NOT EXISTS error TEXT",
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS size_bytes BIGINT",
    ]
    with engine.begin() as conn:
        for stmt in _add_cols:
            try:
                conn.execute(text(stmt))
            except Exception:
                pass
    # Any export/job still marked in-progress at boot is orphaned (the
    # in-process runner does not survive a restart). Mark them errored so the
    # UI resolves instead of polling a "processing" row forever.
    _sweep = [
        ("UPDATE exports SET status='error', "
         "error=COALESCE(error,'interrupted (server restarted mid-export)') "
         "WHERE status IN ('processing','exporting')"),
        ("UPDATE jobs SET status='error', "
         "error=COALESCE(error,'interrupted (server restarted)') "
         "WHERE status IN ('queued','running')"),
    ]
    with engine.begin() as conn:
        for stmt in _sweep:
            try:
                conn.execute(text(stmt))
            except Exception:
                pass
