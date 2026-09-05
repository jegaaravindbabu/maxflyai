"""Non-destructive edits (M3 silence remover seed).

- GET  /{id}/silences : detect silence cuts on the stored media (auto-calibrated)
- GET  /{id}/edits    : list the edit layer
- POST /{id}/edits    : add an edit (silence_cut | manual_cut | retake_remove | caption_edit)
- PATCH/{id}/edits/{edit_id} : toggle/enable-disable an edit

Edits are layered over the immutable transcript and applied only at export.
"""
import os
import tempfile

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import owned_project
from app.models import Project, Edit, Transcript, Segment, CaptionCue
from app.services import ffmpeg_utils, segmentation, retake, fillers, autozoom, filters
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


class AutoZoomIn(BaseModel):
    scale: float = 1.2


@router.delete("/{project_id}/edits/{edit_id}")
def delete_edit(project_id: str, edit_id: str, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    edit = db.get(Edit, edit_id)
    if edit is None or edit.project_id != project_id:
        raise HTTPException(404, "edit not found")
    db.delete(edit)
    db.commit()
    return {"ok": True}


@router.get("/{project_id}/autozoom")
def list_autozoom(project_id: str, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    rows = (db.query(Edit).filter(Edit.project_id == project_id, Edit.type == "zoom")
              .order_by(Edit.created_at).all())
    return [{"id": r.id, "enabled": r.enabled, **(r.payload_json or {})} for r in rows]


@router.post("/{project_id}/autozoom/generate")
def generate_autozoom(project_id: str, body: AutoZoomIn, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    cues = (db.query(CaptionCue).filter(CaptionCue.project_id == project_id)
              .order_by(CaptionCue.idx).all())
    cue_dicts = [{"start_ms": c.start_ms, "end_ms": c.end_ms} for c in cues]
    segs = autozoom.auto_segments(cue_dicts, project.duration_ms or 0, body.scale)
    # replace existing zoom edits
    (db.query(Edit).filter(Edit.project_id == project_id, Edit.type == "zoom")
       .delete(synchronize_session=False))
    created = []
    for z in segs:
        e = Edit(project_id=project_id, type="zoom", payload_json=z, enabled=True)
        db.add(e)
        db.flush()
        created.append({"id": e.id, "enabled": True, **z})
    db.commit()
    return {"count": len(created), "zooms": created}


@router.delete("/{project_id}/autozoom")
def clear_autozoom(project_id: str, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    (db.query(Edit).filter(Edit.project_id == project_id, Edit.type == "zoom")
       .delete(synchronize_session=False))
    db.commit()
    return {"ok": True}


class FilterIn(BaseModel):
    name: str = "none"
    brightness: int = 0
    contrast: int = 0
    saturation: int = 0
    warmth: int = 0


@router.get("/{project_id}/filter")
def get_filter(project_id: str, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    row = (db.query(Edit).filter(Edit.project_id == project_id, Edit.type == "filter")
             .order_by(Edit.created_at.desc()).first())
    p = (row.payload_json or {}) if row else {}
    adj = p.get("adjust", {}) or {}
    return {"name": p.get("name", "none"),
            "brightness": int(adj.get("brightness", 0)),
            "contrast": int(adj.get("contrast", 0)),
            "saturation": int(adj.get("saturation", 0)),
            "warmth": int(adj.get("warmth", 0))}


@router.post("/{project_id}/filter")
def set_filter(project_id: str, body: FilterIn, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    (db.query(Edit).filter(Edit.project_id == project_id, Edit.type == "filter")
       .delete(synchronize_session=False))
    adjust = {"brightness": body.brightness, "contrast": body.contrast,
              "saturation": body.saturation, "warmth": body.warmth}
    has_adjust = any(adjust.values())
    if (body.name and body.name != "none") or has_adjust:
        db.add(Edit(project_id=project_id, type="filter",
                    payload_json={"name": body.name, "adjust": adjust}, enabled=True))
    db.commit()
    return {"name": body.name, **adjust}


class CapSettingsIn(BaseModel):
    font: str | None = None
    bold: int | None = None
    spacing: float | None = None
    outline_w: int | None = None
    shadow: int | None = None
    glow: bool | None = None
    anim_enabled: bool | None = None
    anim: str | None = None
    speed: float | None = None
    scope: str | None = None


@router.get("/{project_id}/caption-settings")
def get_caption_settings(project_id: str, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    row = (db.query(Edit).filter(Edit.project_id == project_id, Edit.type == "capsettings")
             .order_by(Edit.created_at.desc()).first())
    return row.payload_json if row else {}


@router.post("/{project_id}/caption-settings")
def set_caption_settings(project_id: str, body: CapSettingsIn, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    row = (db.query(Edit).filter(Edit.project_id == project_id, Edit.type == "capsettings")
             .order_by(Edit.created_at.desc()).first())
    if row:
        merged = dict(row.payload_json or {})
        merged.update(payload)
        row.payload_json = merged
    else:
        db.add(Edit(project_id=project_id, type="capsettings", payload_json=payload, enabled=True))
        merged = payload
    db.commit()
    return merged


class SavedStyleIn(BaseModel):
    name: str
    style: str = "classic"
    settings: dict = {}


@router.get("/{project_id}/saved-styles")
def list_saved_styles(project_id: str, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    rows = (db.query(Edit).filter(Edit.project_id == project_id, Edit.type == "savedstyle")
              .order_by(Edit.created_at).all())
    return [{"id": r.id, **(r.payload_json or {})} for r in rows]


@router.post("/{project_id}/saved-styles")
def add_saved_style(project_id: str, body: SavedStyleIn, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    e = Edit(project_id=project_id, type="savedstyle",
             payload_json={"name": body.name, "style": body.style, "settings": body.settings},
             enabled=True)
    db.add(e)
    db.commit()
    db.refresh(e)
    return {"id": e.id, "name": body.name, "style": body.style, "settings": body.settings}


class CanvasIn(BaseModel):
    aspect: str | None = None       # original | 9:16 | 4:5 | 1:1 | 16:9
    bg_type: str | None = None      # color | blur | image
    color: str | None = None


@router.get("/{project_id}/canvas")
def get_canvas(project_id: str, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    row = (db.query(Edit).filter(Edit.project_id == project_id, Edit.type == "canvas")
             .order_by(Edit.created_at.desc()).first())
    data = dict(row.payload_json or {}) if row else {}
    if data.get("image_url"):
        data["image_url"] = storage.url(data["image_url"])
    return data


@router.post("/{project_id}/canvas")
def set_canvas(project_id: str, body: CanvasIn, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    row = (db.query(Edit).filter(Edit.project_id == project_id, Edit.type == "canvas")
             .order_by(Edit.created_at.desc()).first())
    if row:
        merged = dict(row.payload_json or {}); merged.update(patch); row.payload_json = merged
    else:
        db.add(Edit(project_id=project_id, type="canvas", payload_json=patch, enabled=True))
        merged = patch
    db.commit()
    out = dict(merged)
    if out.get("image_url"):
        out["image_url"] = storage.url(out["image_url"])
    return out


@router.post("/{project_id}/canvas/image")
async def set_canvas_image(project_id: str, file: UploadFile = File(...),
    db: Session = Depends(get_db), _owner: Project = Depends(owned_project)):
    import os, tempfile
    suffix = os.path.splitext(file.filename or "")[1] or ".jpg"
    fd, tmp = tempfile.mkstemp(suffix=suffix)
    with os.fdopen(fd, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            f.write(chunk)
    try:
        key = storage.save_upload(tmp, file.filename or "canvasbg" + suffix)
    finally:
        if os.path.exists(tmp): os.remove(tmp)
    row = (db.query(Edit).filter(Edit.project_id == project_id, Edit.type == "canvas")
             .order_by(Edit.created_at.desc()).first())
    if row:
        merged = dict(row.payload_json or {}); merged["image_url"] = key; merged["bg_type"] = "image"; row.payload_json = merged
    else:
        db.add(Edit(project_id=project_id, type="canvas", payload_json={"image_url": key, "bg_type": "image"}, enabled=True))
    db.commit()
    return {"image_url": storage.url(key)}
