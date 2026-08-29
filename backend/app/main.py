"""maxfly.ai backend — FastAPI app."""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import init_db
from app.routers import uploads, projects, transcripts, exports, edits, billing
from app.celery_app import celery_app  # noqa: F401  (configures eager mode + registers tasks)

app = FastAPI(title="maxfly.ai API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    init_db()
    os.makedirs(settings.storage_local_dir, exist_ok=True)


@app.get("/api/caption-styles")
def caption_styles():
    from app.services.caption_styles import list_presets
    return {"styles": list_presets()}


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "sarvam_key_set": bool(settings.sarvam_api_key),
        "celery_eager": settings.celery_eager,
        "db": settings.database_url.split(":")[0],
    }


# routers
app.include_router(uploads.router)
app.include_router(projects.router)
app.include_router(transcripts.router)
app.include_router(exports.router)
app.include_router(edits.router)
app.include_router(billing.router)

# serve local media/exports in dev
os.makedirs(settings.storage_local_dir, exist_ok=True)
app.mount("/media", StaticFiles(directory=settings.storage_local_dir), name="media")
