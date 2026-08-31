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
    ]
    with engine.begin() as conn:
        for stmt in _add_cols:
            try:
                conn.execute(text(stmt))
            except Exception:
                pass
