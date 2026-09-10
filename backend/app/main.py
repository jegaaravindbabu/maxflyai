"""maxfly.ai backend — FastAPI app."""
import os
import time

_BOOTED = time.time()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import init_db
from app.routers import uploads, projects, transcripts, exports, edits, billing
from app.celery_app import celery_app  # noqa: F401  (configures eager mode + registers tasks)

app = FastAPI(title="ceyonai API", version="0.1.0")


# Some client-side security software / ad-blockers filter requests whose URL
# contains "/api/projects" (with a UUID) as a suspicious pattern, which made the
# editor fail to load for such users. We therefore ALSO serve the entire project
# API under a neutral prefix; the frontend uses it, and this rewrites it back to
# the real routes. The old prefix keeps working unchanged.
_NEUTRAL = "/api/hub"
_REAL = "/api/projects"


@app.middleware("http")
async def _neutral_prefix(request, call_next):
    path = request.scope.get("path", "")
    if path == _NEUTRAL or path.startswith(_NEUTRAL + "/"):
        request.scope["path"] = _REAL + path[len(_NEUTRAL):]
        raw = request.scope.get("raw_path")
        if raw:
            try:
                request.scope["raw_path"] = (_REAL + path[len(_NEUTRAL):]).encode()
            except Exception:
                pass
    return await call_next(request)


# CORS is added LAST so it is the OUTERMOST middleware. If it is wrapped by the
# _neutral_prefix BaseHTTPMiddleware, that layer drops the Access-Control-Allow-Origin
# header on the way back out and the browser reports "No 'Access-Control-Allow-Origin'".
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list + ["https://ceyonai.com", "https://www.ceyonai.com"],
    allow_origin_regex=r"https://([a-z0-9-]+\.)*(ceyonai\.com|vercel\.app)",
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


@app.get("/api/filter-presets")
def filter_presets():
    from app.services.filters import list_presets, list_groups
    return {"filters": list_presets(), "groups": list_groups()}


@app.get("/api/stock/search")
def stock_search(q: str = ""):
    from app.services import stock
    return {"results": stock.search(q)}


@app.get("/api/stock/videos")
def stock_videos(q: str = ""):
    from app.services import stock
    return {"results": stock.search_videos(q)}


@app.get("/api/health")
def health():
    import resource
    self_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024
    child_rss = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss // 1024
    return {
        "ok": True,
        "commit": (os.environ.get("RENDER_GIT_COMMIT") or "")[:12],
        "uptime_s": int(time.time() - _BOOTED),
        "self_rss_mb": self_rss,
        "child_peak_rss_mb": child_rss,
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
