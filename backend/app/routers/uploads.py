import os
import tempfile

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
