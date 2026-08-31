"""
In-process background job runner.

Heavy work (transcription, and long exports) must not block the HTTP request
(PRD non-functional #1). This runs jobs on a small thread pool so the API returns
immediately and the client polls project/job status.

For production scale, the same task functions are also registered as Celery tasks
(app/tasks/*). Set RUN_MODE=celery + REDIS_URL to dispatch through Celery workers
instead of this in-process pool.
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor

from app.config import settings

log = logging.getLogger("maxfly.runner")

# max_workers=1: on a 512MB instance, run one heavy job (transcribe/export) at a
# time so two ffmpeg encodes never stack and OOM-kill the container.
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="maxfly-job")


def submit(fn, *args, **kwargs) -> None:
    """Fire-and-forget a job on the background pool. Errors are logged; the task
    itself records failure to the DB (project.status/jobs.status = error)."""
    def _wrap():
        try:
            fn(*args, **kwargs)
        except Exception:  # already persisted by the task; just log here
            log.exception("background job failed: %s", getattr(fn, "__name__", fn))
    _executor.submit(_wrap)


def use_celery() -> bool:
    return getattr(settings, "run_mode", "local") == "celery" and bool(settings.redis_url)
