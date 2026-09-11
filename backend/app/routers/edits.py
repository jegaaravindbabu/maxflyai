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
from pydantic import BaseModel, ConfigDict
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


def _pad_and_filter(regions: list[dict], pad_before_ms: int, pad_after_ms: int,
                    min_ms: int, duration_ms: int) -> list[dict]:
    """Shrink each silence region by the speech-protection pads and drop any that
    fall below the minimum, clamping to the clip."""
    out = []
    for r in regions:
        s = int(r["start_ms"]) + max(0, pad_before_ms)
        e = int(r["end_ms"]) - max(0, pad_after_ms)
        if duration_ms:
            s = max(0, min(s, duration_ms)); e = max(0, min(e, duration_ms))
        if e - s >= max(120, min_ms):
            out.append({"start_ms": s, "end_ms": e})
    return out


def _cue_gap_silences(cues: list, duration_ms: int, min_ms: int) -> list[dict]:
    """AI mode: silence = the pauses BETWEEN spoken cues (and lead-in / trailing),
    read straight from caption timings — works at any noise level."""
    spans = sorted([(int(c.start_ms), int(c.end_ms)) for c in cues], key=lambda x: x[0])
    gaps: list[dict] = []
    prev_end = 0
    for s, e in spans:
        if s - prev_end >= min_ms:
            gaps.append({"start_ms": prev_end, "end_ms": s})
        prev_end = max(prev_end, e)
    if duration_ms and duration_ms - prev_end >= min_ms:
        gaps.append({"start_ms": prev_end, "end_ms": duration_ms})
    return gaps


@router.get("/{project_id}/waveform")
def waveform(project_id: str, buckets: int = 400, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    """Downsampled 0..1 audio peaks for the silence-remover waveform preview."""
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    media_path = storage.path(project.source_media_url)
    audio = None
    try:
        audio = ffmpeg_utils.extract_audio(media_path)
        peaks = ffmpeg_utils.audio_peaks(audio, buckets=buckets)
        return {"peaks": peaks, "count": len(peaks), "duration_ms": project.duration_ms or 0}
    except Exception:
        return {"peaks": [], "count": 0, "duration_ms": project.duration_ms or 0}
    finally:
        if audio and audio != media_path and os.path.exists(audio):
            os.remove(audio)


@router.get("/{project_id}/silences")
def detect_silences(project_id: str, mode: str = "audio",
                    noise_db: float | None = None, min_silence_ms: int = 350,
                    pad_before_ms: int = 0, pad_after_ms: int = 0,
                    db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    """Detect silence spans on the media (candidate cuts for review — not applied).
    mode='ai' reads caption timings (no threshold); mode='audio' uses a dB threshold."""
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    dur = project.duration_ms or 0

    if mode == "ai":
        cues = (db.query(CaptionCue).filter(CaptionCue.project_id == project_id)
                  .order_by(CaptionCue.idx).all())
        if cues:
            raw = _cue_gap_silences(cues, dur, min_silence_ms)
            sil = _pad_and_filter(raw, pad_before_ms, pad_after_ms, min_silence_ms, dur)
            total = sum(r["end_ms"] - r["start_ms"] for r in sil)
            return {"mode": "ai", "threshold_db": None, "count": len(sil),
                    "total_ms": total, "silences": sil}
        # no captions yet -> fall through to audio detection

    media_path = storage.path(project.source_media_url)
    audio = None
    try:
        audio = ffmpeg_utils.extract_audio(media_path)
        nz = noise_db
        if nz is None:
            mean = ffmpeg_utils.mean_volume(audio)
            nz = (mean + 2.0) if mean is not None else -30.0
        raw = ffmpeg_utils.detect_silences(audio, noise_db=nz, min_ms=min_silence_ms)
        sil = _pad_and_filter(raw, pad_before_ms, pad_after_ms, min_silence_ms, dur)
        total = sum(r["end_ms"] - r["start_ms"] for r in sil)
        return {"mode": "audio", "threshold_db": round(nz, 1), "count": len(sil),
                "total_ms": total, "silences": sil}
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


@router.get("/{project_id}/retake-plan")
def retake_plan(project_id: str, filler: bool = True, aggressive: bool = False,
                threshold: float = 0.62, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    """Unified word-transcript for the Retake Remover modal.

    Sarvam gives phrase-level (segment) timing, not word-level, so each segment's
    duration is split proportionally across its words. Each word token carries a
    flag: 'retake' (an earlier near-duplicate take), 'filler' (a disfluency
    segment), or null. The client renders the transcript, lets the user toggle
    words, and applies the kept 'remove' tokens as ripple-delete cuts."""
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    transcript = (db.query(Transcript).filter(Transcript.project_id == project_id)
                    .order_by(Transcript.created_at.desc()).first())
    if transcript is None:
        return {"tokens": [], "retake_count": 0, "filler_count": 0, "total_ms": 0}
    segs = (db.query(Segment).filter(Segment.transcript_id == transcript.id)
              .order_by(Segment.idx).all())
    seg_dicts = [{"idx": s.idx, "text": s.text or "", "start_ms": s.start_ms,
                  "end_ms": s.end_ms} for s in segs]

    # segment idx -> flag
    flag: dict[int, str] = {}
    cands = retake.find_retakes(seg_dicts, threshold=threshold)
    retake_segs = set()
    for c in cands:
        for cut in c.get("cuts", []):
            retake_segs.add(cut["idx"])
    for i in retake_segs:
        flag[i] = "retake"
    filler_count_segs = 0
    if filler:
        fcuts = fillers.detect_filler_cuts(
            [{"text": d["text"], "start_ms": d["start_ms"], "end_ms": d["end_ms"], "idx": d["idx"]}
             for d in seg_dicts], aggressive=aggressive)
        franges = {(f["start_ms"], f["end_ms"]) for f in fcuts}
        for d in seg_dicts:
            if (d["start_ms"], d["end_ms"]) in franges and d["idx"] not in flag:
                flag[d["idx"]] = "filler"
                filler_count_segs += 1

    tokens = []
    ti = 0
    for d in seg_dicts:
        words = (d["text"] or "").split()
        if not words:
            continue
        s0, e0 = int(d["start_ms"]), int(d["end_ms"])
        span = max(1, e0 - s0)
        n = len(words)
        fl = flag.get(d["idx"])
        for wi, w in enumerate(words):
            ws = s0 + round(span * wi / n)
            we = s0 + round(span * (wi + 1) / n)
            tokens.append({"i": ti, "seg_idx": d["idx"], "text": w,
                           "start_ms": ws, "end_ms": we, "flag": fl})
            ti += 1

    total = sum(t["end_ms"] - t["start_ms"] for t in tokens if t["flag"])
    return {"tokens": tokens, "retake_count": len(retake_segs),
            "filler_count": filler_count_segs, "total_ms": total}


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
    density: str = "balanced"       # fewer | balanced | more
    scale: float | None = None      # legacy; ignored when density is used


class AutoZoomAddIn(BaseModel):
    start_ms: int
    end_ms: int | None = None
    strength: str = "medium"


class ZoomPatchIn(BaseModel):
    start_ms: int | None = None
    end_ms: int | None = None
    strength: str | None = None
    fx: float | None = None
    fy: float | None = None
    ease_in: float | str | None = None
    ease_out: float | str | None = None
    enabled: bool | None = None


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
    segs = autozoom.auto_segments(cue_dicts, project.duration_ms or 0, body.density)
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


@router.post("/{project_id}/autozoom/add")
def add_autozoom(project_id: str, body: AutoZoomAddIn, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    start = max(0, int(body.start_ms))
    end = int(body.end_ms) if body.end_ms is not None else start + 2000
    if end <= start:
        end = start + 2000
    dur = project.duration_ms or 0
    if dur:
        end = min(end, dur)
        if end <= start:
            start = max(0, end - 2000)
    z = autozoom.default_zoom(start, end, body.strength, source="manual")
    e = Edit(project_id=project_id, type="zoom", payload_json=z, enabled=True)
    db.add(e)
    db.flush()
    out = {"id": e.id, "enabled": True, **z}
    db.commit()
    return out


@router.patch("/{project_id}/autozoom/{zoom_id}")
def patch_autozoom(project_id: str, zoom_id: str, body: ZoomPatchIn,
    db: Session = Depends(get_db), _owner: Project = Depends(owned_project)):
    edit = db.get(Edit, zoom_id)
    if edit is None or edit.project_id != project_id or edit.type != "zoom":
        raise HTTPException(404, "zoom not found")
    p = dict(edit.payload_json or {})
    data = body.model_dump(exclude_unset=True)
    if "enabled" in data:
        edit.enabled = bool(data.pop("enabled"))
    for key in ("start_ms", "end_ms"):
        if key in data and data[key] is not None:
            p[key] = int(data[key])
    for key in ("fx", "fy"):
        if key in data and data[key] is not None:
            p[key] = max(0.0, min(float(data[key]), 1.0))
    if data.get("strength"):
        st = str(data["strength"]).lower()
        if st in autozoom.STRENGTH:
            p["strength"] = st
            p["scale"] = autozoom.strength_scale(st)
    for key in ("ease_in", "ease_out"):
        if key in data and data[key] is not None:
            v = data[key]
            if isinstance(v, str):
                p[key] = autozoom.SPEED.get(v.lower(), 0.35)
            else:
                p[key] = max(0.05, min(float(v), 1.5))
    if p.get("end_ms", 0) <= p.get("start_ms", 0):
        p["end_ms"] = p.get("start_ms", 0) + 500
    edit.payload_json = p
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(edit, "payload_json")
    db.commit()
    return {"id": edit.id, "enabled": edit.enabled, **p}


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


class FilterLayerIn(BaseModel):
    name: str = "none"
    brightness: int = 0
    contrast: int = 0
    saturation: int = 0
    warmth: int = 0
    start_ms: int = 0
    end_ms: int = 3000


class FilterLayerPatch(BaseModel):
    name: str | None = None
    brightness: int | None = None
    contrast: int | None = None
    saturation: int | None = None
    warmth: int | None = None
    start_ms: int | None = None
    end_ms: int | None = None


def _layer_out(e: Edit) -> dict:
    p = e.payload_json or {}
    a = p.get("adjust", {}) or {}
    return {"id": e.id, "name": p.get("name", "none"),
            "brightness": int(a.get("brightness", 0)), "contrast": int(a.get("contrast", 0)),
            "saturation": int(a.get("saturation", 0)), "warmth": int(a.get("warmth", 0)),
            "start_ms": int(p.get("start_ms", 0)), "end_ms": int(p.get("end_ms", 0))}


@router.get("/{project_id}/filter-layers")
def list_filter_layers(project_id: str, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    rows = (db.query(Edit).filter(Edit.project_id == project_id, Edit.type == "filter_layer")
              .order_by(Edit.created_at).all())
    return {"layers": [_layer_out(r) for r in rows]}


@router.post("/{project_id}/filter-layers")
def add_filter_layer(project_id: str, body: FilterLayerIn, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    e = Edit(project_id=project_id, type="filter_layer", enabled=True, payload_json={
        "name": body.name,
        "adjust": {"brightness": body.brightness, "contrast": body.contrast,
                   "saturation": body.saturation, "warmth": body.warmth},
        "start_ms": body.start_ms, "end_ms": max(body.end_ms, body.start_ms + 200)})
    db.add(e)
    db.commit()
    db.refresh(e)
    return _layer_out(e)


@router.patch("/{project_id}/filter-layers/{layer_id}")
def update_filter_layer(project_id: str, layer_id: str, body: FilterLayerPatch,
    db: Session = Depends(get_db), _owner: Project = Depends(owned_project)):
    e = db.get(Edit, layer_id)
    if e is None or e.project_id != project_id or e.type != "filter_layer":
        raise HTTPException(404, "layer not found")
    p = dict(e.payload_json or {})
    a = dict(p.get("adjust", {}) or {})
    if body.name is not None: p["name"] = body.name
    for k in ("brightness", "contrast", "saturation", "warmth"):
        v = getattr(body, k)
        if v is not None: a[k] = int(v)
    p["adjust"] = a
    if body.start_ms is not None: p["start_ms"] = int(body.start_ms)
    if body.end_ms is not None: p["end_ms"] = int(body.end_ms)
    if p.get("end_ms", 0) <= p.get("start_ms", 0):
        p["end_ms"] = p.get("start_ms", 0) + 200
    e.payload_json = p
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(e, "payload_json")
    db.commit()
    db.refresh(e)
    return _layer_out(e)


@router.delete("/{project_id}/filter-layers/{layer_id}")
def delete_filter_layer(project_id: str, layer_id: str, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    e = db.get(Edit, layer_id)
    if e is None or e.project_id != project_id or e.type != "filter_layer":
        raise HTTPException(404, "layer not found")
    db.delete(e)
    db.commit()
    return {"ok": True}


class CapSettingsIn(BaseModel):
    # allow extra part-prefixed keys (big_*, top_*) so every Caption-settings
    # control persists through the save round-trip.
    model_config = ConfigDict(extra="allow")
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
    when: str | None = None
    # maxfly.ai-parity caption settings
    case: str | None = None          # as_typed|upper|lower|title
    opacity: int | None = None       # 0..100
    pos_v: int | None = None         # vertical offset px (+up)
    pos_h: int | None = None         # horizontal offset px (+right)
    letter_gap: float | None = None  # letter spacing px
    word_gap: float | None = None    # word spacing px (preview)
    layer: str | None = None         # front|back
    weight: str | None = None        # font weight label (preview)


class VideoFxIn(BaseModel):
    # full video-tab effects blob (opacity/blur/crop/rounded/outline/shadow +
    # In/Loop/Out animations). Extra keys allowed so the client owns the shape.
    model_config = ConfigDict(extra="allow")


@router.get("/{project_id}/videofx")
def get_videofx(project_id: str, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    row = (db.query(Edit).filter(Edit.project_id == project_id, Edit.type == "videofx")
             .order_by(Edit.created_at.desc()).first())
    return row.payload_json if row else {}


@router.post("/{project_id}/videofx")
def set_videofx(project_id: str, body: VideoFxIn, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    # replace the whole blob (the client always sends the complete effects object)
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    row = (db.query(Edit).filter(Edit.project_id == project_id, Edit.type == "videofx")
             .order_by(Edit.created_at.desc()).first())
    if row:
        row.payload_json = payload
    else:
        db.add(Edit(project_id=project_id, type="videofx", payload_json=payload, enabled=True))
    db.commit()
    return payload


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


class CapOverrideIn(BaseModel):
    idx: int
    settings: dict = {}
    clear: bool = False


@router.get("/{project_id}/caption-overrides")
def get_caption_overrides(project_id: str, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    row = (db.query(Edit).filter(Edit.project_id == project_id, Edit.type == "capoverrides")
             .order_by(Edit.created_at.desc()).first())
    return row.payload_json if row else {}


@router.post("/{project_id}/caption-overrides")
def set_caption_override(project_id: str, body: CapOverrideIn, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    row = (db.query(Edit).filter(Edit.project_id == project_id, Edit.type == "capoverrides")
             .order_by(Edit.created_at.desc()).first())
    data = dict(row.payload_json or {}) if row else {}
    key = str(body.idx)
    if body.clear:
        data.pop(key, None)
    else:
        cur = dict(data.get(key) or {})
        cur.update({k: v for k, v in body.settings.items() if v is not None})
        data[key] = cur
    if row:
        row.payload_json = data
    else:
        db.add(Edit(project_id=project_id, type="capoverrides", payload_json=data, enabled=True))
    db.commit()
    return data


class WordOverrideIn(BaseModel):
    idx: int
    word: int
    settings: dict = {}
    clear: bool = False


@router.get("/{project_id}/word-overrides")
def get_word_overrides(project_id: str, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    row = (db.query(Edit).filter(Edit.project_id == project_id, Edit.type == "wordoverrides")
             .order_by(Edit.created_at.desc()).first())
    return row.payload_json if row else {}


@router.post("/{project_id}/word-overrides")
def set_word_override(project_id: str, body: WordOverrideIn, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    row = (db.query(Edit).filter(Edit.project_id == project_id, Edit.type == "wordoverrides")
             .order_by(Edit.created_at.desc()).first())
    data = dict(row.payload_json or {}) if row else {}
    ci, wi = str(body.idx), str(body.word)
    wmap = dict(data.get(ci) or {})
    if body.clear:
        wmap.pop(wi, None)
    else:
        cur = dict(wmap.get(wi) or {})
        for k, v in body.settings.items():
            if v is None:
                cur.pop(k, None)   # null clears a single field (e.g. bring a moved word back inline)
            else:
                cur[k] = v
        if cur:
            wmap[wi] = cur
        else:
            wmap.pop(wi, None)
    if wmap:
        data[ci] = wmap
    else:
        data.pop(ci, None)
    if row:
        row.payload_json = data
    else:
        db.add(Edit(project_id=project_id, type="wordoverrides", payload_json=data, enabled=True))
    db.commit()
    return data


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
    blur_amount: str | None = None  # light | medium | heavy
    scale_pct: int | None = None    # foreground video size, 30..100


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
