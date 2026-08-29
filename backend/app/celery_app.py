"""Celery app. When REDIS_URL is empty we run eager (inline) so dev needs no broker."""
from celery import Celery
from app.config import settings

broker = settings.redis_url or "memory://"
backend = settings.redis_url or "cache+memory://"

celery_app = Celery("maxfly", broker=broker, backend=backend)
celery_app.conf.update(
    task_always_eager=settings.celery_eager,
    task_eager_propagates=True,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
)

# Make this the global default app so tasks resolve to it even from FastAPI
# worker threads (Celery's current_app is thread-local; set_default covers all).
celery_app.set_default()

# ensure tasks are registered
from app.tasks import transcribe as _t  # noqa: E402,F401
from app.tasks import exporting as _e  # noqa: E402,F401
