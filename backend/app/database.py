"""SQLAlchemy engine + session. SQLite for dev, Postgres/Supabase for prod."""
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings

# Engine config. Postgres in prod runs behind Supabase's transaction-mode
# pooler (port 6543 / pgbouncer): it does NOT support server-side prepared
# statements, so psycopg3 must disable them (prepare_threshold=None). A bounded
# SQLAlchemy pool + pre-ping + recycle keeps connections healthy under load.
_url = settings.database_url
connect_args: dict = {}
engine_kwargs: dict = {"future": True, "pool_pre_ping": True}
if _url.startswith("sqlite"):
    connect_args["check_same_thread"] = False
else:
    engine_kwargs.update(pool_size=5, max_overflow=10, pool_recycle=300)
    if "+psycopg" in _url and "psycopg2" not in _url:
        connect_args["prepare_threshold"] = None   # pgbouncer transaction-pooler safe

engine = create_engine(_url, connect_args=connect_args, **engine_kwargs)
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
