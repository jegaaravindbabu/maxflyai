import os
import tempfile
import hmac
import hashlib

from fastapi import APIRouter, UploadFile, File, Form, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Project
from app.schemas import ProjectOut
from app.services import ffmpeg_utils
from app.services.storage import storage
from app.services.auth import current_user
from app.config import settings
from fastapi import HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/projects", tags=["uploads"])


@router.post("", response_model=ProjectOut)
async def create_project(file: UploadFile = File(...), name: str = Form(None),
                         db: Session = Depends(get_db),
                         user: str | None = Depends(current_user)):
    # write upload to a temp file, probe, store
    suffix = os.path.splitext(file.filename or "")[1] or ".mp4"
    fd, tmp = tempfile.mkstemp(suffix=suffix)
    max_bytes = max(1, int(settings.upload_max_mb)) * 1024 * 1024
    total = 0
    try:
        with os.fdopen(fd, "wb") as f:
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > max_bytes:
                    raise HTTPException(413, f"File is too large (max {settings.upload_max_mb} MB).")
                f.write(chunk)
    except HTTPException:
        if os.path.exists(tmp): os.remove(tmp)
        raise
    try:
        duration_ms = ffmpeg_utils.probe_duration_ms(tmp)
        if not duration_ms:
            raise HTTPException(400, "That file doesn't look like a video/audio we can read. "
                                     "Try MP4, MOV, or a common format.")
        try: size_bytes = os.path.getsize(tmp)
        except Exception: size_bytes = None
        key = storage.save_upload(tmp, file.filename or "upload" + suffix)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)

    project = Project(
        user_id=user,
        name=name or (file.filename or "Untitled"),
        source_media_url=key, source_filename=file.filename,
        duration_ms=duration_ms, size_bytes=size_bytes, status="uploaded",
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


class _SignUploadIn(BaseModel):
    filename: str | None = None


class _FinalizeIn(BaseModel):
    key: str
    sig: str
    filename: str | None = None
    name: str | None = None
    duration_ms: int | None = None
    size_bytes: int | None = None


def _upload_sig(key: str) -> str:
    secret = (settings.supabase_service_role_key or "maxfly-upload").encode()
    return hmac.new(secret, key.encode(), hashlib.sha256).hexdigest()[:32]


@router.post("/direct/sign")
def sign_upload(body: _SignUploadIn, user: str | None = Depends(current_user)):
    """Hand the browser a signed URL to upload straight to storage. Returns
    {supported: false} whenever direct upload isn't available so the client
    transparently falls back to the through-backend upload."""
    if not getattr(storage, "supports_direct", False):
        return {"supported": False}
    try:
        info = storage.sign_upload(body.filename or "upload.mp4")
    except Exception:
        return {"supported": False}
    return {"supported": True, "key": info["key"],
            "upload_url": info["upload_url"], "sig": _upload_sig(info["key"])}


@router.post("/direct/finalize", response_model=ProjectOut)
def finalize_upload(body: _FinalizeIn, db: Session = Depends(get_db),
                    user: str | None = Depends(current_user)):
    """Create the project row after the browser uploaded the file directly to
    storage. The sig proves the key was issued by /direct/sign; head() confirms
    the file actually landed before we create the project."""
    if not getattr(storage, "supports_direct", False):
        raise HTTPException(400, "direct upload not supported")
    if not hmac.compare_digest(_upload_sig(body.key), body.sig or ""):
        raise HTTPException(400, "invalid upload token")
    size = storage.head(body.key)
    if size is None:
        raise HTTPException(400, "Upload not found - please try again.")
    max_bytes = max(1, int(settings.upload_max_mb)) * 1024 * 1024
    if size and size > max_bytes:
        try: storage.delete(body.key)
        except Exception: pass
        raise HTTPException(413, f"File is too large (max {settings.upload_max_mb} MB).")
    dur = int(body.duration_ms or 0)
    project = Project(
        user_id=user,
        name=body.name or (body.filename or "Untitled"),
        source_media_url=body.key, source_filename=body.filename,
        duration_ms=dur or None, size_bytes=(size or body.size_bytes),
        status="uploaded",
    )
    db.add(project); db.commit(); db.refresh(project)
    return project

