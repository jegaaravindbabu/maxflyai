"""Non-destructive edits (M3 silence remover seed).

- GET  /{id}/silences : detect silence cuts on the stored media (auto-calibrated)
- GET  /{id}/edits    : list the edit layer
- POST /{id}/edits    : add an edit (silence_cut | manual_cut | retake_remove | caption_edit)
- PATCH/{id}/edits/{edit_id} : toggle/enable-disable an edit

Edits are layered over the immutable transcript and applied only at export.
"""
import os
import tempfile

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import owned_project
from app.models import Project, Edit, Transcript, Segment
from app.services import ffmpeg_utils, segmentation, retake, fillers
from app.services.storage import storage

router = APIRouter(prefix="/api/projects", tags=["edits"])


class EditIn(BaseModel):
    type: str = "silence_cut"        # silence_cut|manual_cut|retake_remove|caption_edit
    payload_json: dict = {}
    enabled: bool = True


class EditToggle(BaseModel):
    enabled: bool


@router.get("/{project_id}/silences")
def detect_silences(project_id: str, noise_db: float | None = None,
                    min_silence_ms: int = 350, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    """Detect silence spans on the media (candidate cuts for review — not applied)."""
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    media_path = storage.path(project.source_media_url)
    audio = None
    try:
        audio = ffmpeg_utils.extract_audio(media_path)
        if noise_db is None:
            mean = ffmpeg_utils.mean_volume(audio)
            noise_db = (mean + 2.0) if mean is not None else -30.0
        silences = ffmpeg_utils.detect_silences(audio, noise_db=noise_db, min_ms=min_silence_ms)
        return {"threshold_db": round(noise_db, 1), "count": len(silences), "silences": silences}
    finally:
        if audio and audio != media_path and os.path.exists(audio):
            os.remove(audio)


@router.get("/{project_id}/edits")
def list_edits(project_id: str, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    return (db.query(Edit).filter(Edit.project_id == project_id)
              .order_by(Edit.created_at).all())


@router.post("/{project_id}/edits")
def add_edit(project_id: str, body: EditIn, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    edit = Edit(project_id=project_id, type=body.type,
                payload_json=body.payload_json, enabled=body.enabled)
    db.add(edit)
    db.commit()
    db.refresh(edit)
    return {"id": edit.id, "type": edit.type, "enabled": edit.enabled,
            "payload_json": edit.payload_json}


@router.patch("/{project_id}/edits/{edit_id}")
def toggle_edit(project_id: str, edit_id: str, body: EditToggle,
                db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    edit = db.get(Edit, edit_id)
    if edit is None or edit.project_id != project_id:
        raise HTTPException(404, "edit not found")
    edit.enabled = body.enabled
    db.commit()
    return {"id": edit.id, "enabled": edit.enabled}


@router.get("/{project_id}/retakes")
def detect_retakes(project_id: str, threshold: float = 0.62,
                   db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    """Suggest near-duplicate consecutive takes to remove (keep the last take)."""
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    transcript = (db.query(Transcript).filter(Transcript.project_id == project_id)
                    .order_by(Transcript.created_at.desc()).first())
    if transcript is None:
        return {"count": 0, "candidates": []}
    segs = (db.query(Segment).filter(Segment.transcript_id == transcript.id)
              .order_by(Segment.idx).all())
    seg_dicts = [{"idx": s.idx, "text": s.text, "start_ms": s.start_ms, "end_ms": s.end_ms}
                 for s in segs]
    cands = retake.find_retakes(seg_dicts, threshold=threshold)
    return {"count": len(cands), "candidates": cands}


@router.get("/{project_id}/fillers")
def detect_fillers(project_id: str, aggressive: bool = False,
                   db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    """Detect filler-word segments (uh/um/hmm...) safe to cut."""
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    transcript = (db.query(Transcript).filter(Transcript.project_id == project_id)
                    .order_by(Transcript.created_at.desc()).first())
    if transcript is None:
        return {"count": 0, "fillers": []}
    segs = (db.query(Segment).filter(Segment.transcript_id == transcript.id)
              .order_by(Segment.idx).all())
    seg_dicts = [{"text": s.text, "start_ms": s.start_ms, "end_ms": s.end_ms} for s in segs]
    cuts = fillers.detect_filler_cuts(seg_dicts, aggressive=aggressive)
    total = sum(c["end_ms"] - c["start_ms"] for c in cuts)
    return {"count": len(cuts), "removed_ms": total, "fillers": cuts}
