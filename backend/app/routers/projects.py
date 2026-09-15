from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.deps import owned_project
from app.models import Project, Segment, Transcript, CaptionCue, Job, TextOverlay, ImageOverlay, BrollClip, CaptionTranslation
from app.schemas import ProjectOut, ProjectDetail, SegmentOut, CueOut, OverlayOut, OverlayIn, OverlayPatch, ImageOut, ImagePatch, BrollOut, BrollPatch, TranslationOut, TransCueOut
from app.services.auth import current_user, is_admin
from app.services.storage import storage
from app.services import ffmpeg_utils
import os, tempfile, subprocess, base64
import httpx

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db), user: str | None = Depends(current_user),
                  admin: bool = Depends(is_admin)):
    q = db.query(Project)
    if user is not None and not admin:
        q = q.filter(Project.user_id == user)
    projects = q.order_by(Project.created_at.desc()).all()
    if projects:
        from sqlalchemy import func
        counts = dict(
            db.query(CaptionCue.project_id, func.count(CaptionCue.id))
              .filter(CaptionCue.project_id.in_([p.id for p in projects]))
              .group_by(CaptionCue.project_id).all()
        )
        for p in projects:
            p.sub_count = counts.get(p.id, 0)
    return projects


def _build_project_detail(project_id: str, db: Session) -> ProjectDetail:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "project not found")

    transcript = (db.query(Transcript)
                    .filter(Transcript.project_id == project_id)
                    .order_by(Transcript.created_at.desc()).first())
    segments = []
    if transcript:
        segments = (db.query(Segment)
                      .filter(Segment.transcript_id == transcript.id)
                      .order_by(Segment.idx).all())
    cues = (db.query(CaptionCue)
              .filter(CaptionCue.project_id == project_id)
              .order_by(CaptionCue.idx).all())

    detail = ProjectDetail.model_validate(project)
    detail.media_url = storage.url(project.source_media_url) if project.source_media_url else None
    detail.segments = [SegmentOut.model_validate(s) for s in segments]
    detail.cues = [CueOut.model_validate(c) for c in cues]
    overlays = (db.query(TextOverlay).filter(TextOverlay.project_id == project_id)
                  .order_by(TextOverlay.idx).all())
    detail.overlays = [OverlayOut.model_validate(o) for o in overlays]
    imgs = (db.query(ImageOverlay).filter(ImageOverlay.project_id == project_id)
              .order_by(ImageOverlay.idx).all())
    detail.images = [ImageOut(id=i.id, idx=i.idx, image_url=storage.url(i.image_url),
                              start_ms=i.start_ms, end_ms=i.end_ms, x_pct=i.x_pct,
                              y_pct=i.y_pct, size_pct=i.size_pct) for i in imgs]
    brolls = (db.query(BrollClip).filter(BrollClip.project_id == project_id)
                .order_by(BrollClip.idx).all())
    detail.brolls = [_broll_out(b) for b in brolls]
    _trs = (db.query(CaptionTranslation).filter(CaptionTranslation.project_id == project_id)
              .order_by(CaptionTranslation.lang, CaptionTranslation.idx).all())
    _by_lang: dict = {}
    for _t in _trs:
        _by_lang.setdefault(_t.lang, []).append(TransCueOut(idx=_t.idx, start_ms=_t.start_ms, end_ms=_t.end_ms, text=_t.text))
    detail.translations = [TranslationOut(lang=_k, cues=_v) for _k, _v in _by_lang.items()]
    if transcript:
        detail.language_code = transcript.language_code
        detail.mode = transcript.mode
    return detail


@router.get("/{project_id}", response_model=ProjectDetail)
def get_project(project_id: str, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    return _build_project_detail(project_id, db)


_FRAME_CACHE: dict[str, str] = {}


@router.get("/{project_id}/frame")
def project_frame(project_id: str, db: Session = Depends(get_db),
                  _owner: Project = Depends(owned_project)):
    """A small JPEG data-URL of a representative frame of the project's video,
    for the Filters panel thumbnails. Generated server-side with ffmpeg so it
    works regardless of the browser's cross-origin canvas restrictions."""
    project = db.get(Project, project_id)
    if project is None or not project.source_media_url:
        raise HTTPException(404, "no media")
    key = project.source_media_url
    if key in _FRAME_CACHE:
        return {"data_url": _FRAME_CACHE[key]}
    url = storage.url(key)
    if not url:
        raise HTTPException(404, "no media url")

    def _grab(ss: str) -> bytes:
        try:
            p = subprocess.run(
                ["ffmpeg", "-nostdin", "-y", "-ss", ss, "-i", url,
                 "-frames:v", "1", "-vf", "scale=240:-1", "-f", "mjpeg", "pipe:1"],
                capture_output=True, timeout=60)
            return p.stdout or b""
        except Exception:
            return b""

    data = _grab("1") or _grab("0")
    if not data:
        raise HTTPException(422, "could not extract frame")
    durl = "data:image/jpeg;base64," + base64.b64encode(data).decode()
    _FRAME_CACHE[key] = durl
    return {"data_url": durl}


class DetailIn(BaseModel):
    project_id: str


@router.post("/detail", response_model=ProjectDetail)
def project_detail_alias(body: DetailIn, db: Session = Depends(get_db),
                         user: str | None = Depends(current_user),
                         admin: bool = Depends(is_admin)):
    """Alternate route for the editor's project load. Some security software
    (antivirus 'web protection', ad-blockers) silently blocks the direct
    /projects/{uuid} URL pattern; the frontend falls back to this POST."""
    project = db.get(Project, body.project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    if not admin and user is not None and project.user_id != user:
        raise HTTPException(404, "project not found")
    return _build_project_detail(body.project_id, db)


@router.get("/{project_id}/status")
def project_status(project_id: str, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    """Cheap polling endpoint used while a job runs (avoids refetching cues)."""
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    job = (db.query(Job).filter(Job.project_id == project_id)
             .order_by(Job.created_at.desc()).first())
    return {"status": project.status, "error": project.error,
            "job": ({"kind": job.kind, "status": job.status, "error": job.error}
                    if job else None)}


class RenameIn(BaseModel):
    name: str


@router.patch("/{project_id}", response_model=ProjectOut)
def rename_project(project_id: str, body: RenameIn, db: Session = Depends(get_db),
    project: Project = Depends(owned_project)):
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "name required")
    project.name = name
    db.commit()
    db.refresh(project)
    return project


@router.delete("/{project_id}")
def delete_project(project_id: str, db: Session = Depends(get_db),
    project: Project = Depends(owned_project)):
    db.delete(project)   # cascades to transcripts/segments/cues/edits/exports/jobs
    db.commit()
    return {"ok": True, "deleted": project_id}


@router.post("/{project_id}/duplicate", response_model=ProjectOut)
def duplicate_project(project_id: str, db: Session = Depends(get_db),
    src: Project = Depends(owned_project), user: str | None = Depends(current_user)):
    copy = Project(
        user_id=src.user_id,
        name=(src.name or "Untitled") + " (copy)",
        source_media_url=src.source_media_url,
        source_filename=src.source_filename,
        duration_ms=src.duration_ms,
        status=src.status,
    )
    db.add(copy)
    db.flush()   # assign copy.id

    # copy latest transcript + its segments
    transcript = (db.query(Transcript)
                    .filter(Transcript.project_id == project_id)
                    .order_by(Transcript.created_at.desc()).first())
    if transcript:
        tcopy = Transcript(
            project_id=copy.id, language_code=transcript.language_code,
            mode=transcript.mode, provider=transcript.provider,
            provider_job_id=transcript.provider_job_id, raw_json=transcript.raw_json,
        )
        db.add(tcopy)
        db.flush()
        for seg in (db.query(Segment).filter(Segment.transcript_id == transcript.id)
                      .order_by(Segment.idx).all()):
            db.add(Segment(transcript_id=tcopy.id, idx=seg.idx, text=seg.text,
                           translit_text=seg.translit_text, start_ms=seg.start_ms,
                           end_ms=seg.end_ms, speaker=seg.speaker, confidence=seg.confidence))

    # copy derived cues
    for c in (db.query(CaptionCue).filter(CaptionCue.project_id == project_id)
                .order_by(CaptionCue.idx).all()):
        db.add(CaptionCue(project_id=copy.id, idx=c.idx, start_ms=c.start_ms,
                          end_ms=c.end_ms, text=c.text, translit_text=c.translit_text,
                          line_count=c.line_count))

    db.commit()
    db.refresh(copy)
    return copy


@router.get("/{project_id}/overlays", response_model=list[OverlayOut])
def list_overlays(project_id: str, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    return (db.query(TextOverlay).filter(TextOverlay.project_id == project_id)
              .order_by(TextOverlay.idx).all())


@router.post("/{project_id}/overlays", response_model=OverlayOut)
def add_overlay(project_id: str, body: OverlayIn, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    n = db.query(TextOverlay).filter(TextOverlay.project_id == project_id).count()
    o = TextOverlay(project_id=project_id, idx=n, text=body.text,
                    start_ms=body.start_ms, end_ms=max(body.end_ms, body.start_ms + 300),
                    x_pct=body.x_pct, y_pct=body.y_pct, font_size=body.font_size,
                    color=body.color, bold=body.bold)
    db.add(o)
    db.commit()
    db.refresh(o)
    return o


@router.patch("/{project_id}/overlays/{overlay_id}", response_model=OverlayOut)
def update_overlay(project_id: str, overlay_id: str, body: OverlayPatch,
    db: Session = Depends(get_db), _owner: Project = Depends(owned_project)):
    o = (db.query(TextOverlay)
           .filter(TextOverlay.project_id == project_id, TextOverlay.id == overlay_id).first())
    if o is None:
        raise HTTPException(404, "overlay not found")
    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(o, field, val)
    db.commit()
    db.refresh(o)
    return o


@router.delete("/{project_id}/overlays/{overlay_id}")
def delete_overlay(project_id: str, overlay_id: str, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    o = (db.query(TextOverlay)
           .filter(TextOverlay.project_id == project_id, TextOverlay.id == overlay_id).first())
    if o is None:
        raise HTTPException(404, "overlay not found")
    db.delete(o)
    db.commit()
    return {"ok": True}


def _img_out(i: ImageOverlay) -> ImageOut:
    return ImageOut(id=i.id, idx=i.idx, image_url=storage.url(i.image_url),
                    start_ms=i.start_ms, end_ms=i.end_ms, x_pct=i.x_pct,
                    y_pct=i.y_pct, size_pct=i.size_pct)


@router.get("/{project_id}/images", response_model=list[ImageOut])
def list_images(project_id: str, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    rows = (db.query(ImageOverlay).filter(ImageOverlay.project_id == project_id)
              .order_by(ImageOverlay.idx).all())
    return [_img_out(i) for i in rows]


@router.post("/{project_id}/images", response_model=ImageOut)
async def add_image(project_id: str, file: UploadFile = File(...),
    start_ms: int = Form(0), end_ms: int = Form(3000),
    x_pct: float = Form(50.0), y_pct: float = Form(20.0), size_pct: float = Form(40.0),
    db: Session = Depends(get_db), _owner: Project = Depends(owned_project)):
    suffix = os.path.splitext(file.filename or "")[1] or ".png"
    fd, tmp = tempfile.mkstemp(suffix=suffix)
    with os.fdopen(fd, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            f.write(chunk)
    try:
        key = storage.save_upload(tmp, file.filename or "image" + suffix)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    n = db.query(ImageOverlay).filter(ImageOverlay.project_id == project_id).count()
    o = ImageOverlay(project_id=project_id, idx=n, image_url=key,
                     start_ms=start_ms, end_ms=max(end_ms, start_ms + 300),
                     x_pct=x_pct, y_pct=y_pct, size_pct=size_pct)
    db.add(o)
    db.commit()
    db.refresh(o)
    return _img_out(o)


@router.patch("/{project_id}/images/{image_id}", response_model=ImageOut)
def update_image(project_id: str, image_id: str, body: ImagePatch,
    db: Session = Depends(get_db), _owner: Project = Depends(owned_project)):
    o = (db.query(ImageOverlay)
           .filter(ImageOverlay.project_id == project_id, ImageOverlay.id == image_id).first())
    if o is None:
        raise HTTPException(404, "image not found")
    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(o, field, val)
    db.commit()
    db.refresh(o)
    return _img_out(o)


@router.delete("/{project_id}/images/{image_id}")
def delete_image(project_id: str, image_id: str, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    o = (db.query(ImageOverlay)
           .filter(ImageOverlay.project_id == project_id, ImageOverlay.id == image_id).first())
    if o is None:
        raise HTTPException(404, "image not found")
    db.delete(o)
    db.commit()
    return {"ok": True}


def _broll_out(b: BrollClip) -> BrollOut:
    return BrollOut(id=b.id, idx=b.idx, video_url=storage.url(b.video_url),
                    start_ms=b.start_ms, end_ms=b.end_ms, x_pct=b.x_pct,
                    y_pct=b.y_pct, size_pct=b.size_pct, track=getattr(b, "track", 1) or 1,
                    opacity=getattr(b, "opacity", 100), round_pct=getattr(b, "round_pct", 0),
                    crop_t=getattr(b, "crop_t", 0), crop_r=getattr(b, "crop_r", 0),
                    crop_b=getattr(b, "crop_b", 0), crop_l=getattr(b, "crop_l", 0))


@router.get("/{project_id}/brolls", response_model=list[BrollOut])
def list_brolls(project_id: str, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    rows = (db.query(BrollClip).filter(BrollClip.project_id == project_id)
              .order_by(BrollClip.idx).all())
    return [_broll_out(b) for b in rows]


@router.post("/{project_id}/brolls", response_model=BrollOut)
async def add_broll(project_id: str, file: UploadFile = File(...),
    start_ms: int = Form(0), end_ms: int = Form(3000),
    x_pct: float = Form(0.0), y_pct: float = Form(0.0), size_pct: float = Form(100.0),
    db: Session = Depends(get_db), _owner: Project = Depends(owned_project)):
    suffix = os.path.splitext(file.filename or "")[1] or ".mp4"
    fd, tmp = tempfile.mkstemp(suffix=suffix)
    with os.fdopen(fd, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            f.write(chunk)
    try:
        key = storage.save_upload(tmp, file.filename or "broll" + suffix)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    n = db.query(BrollClip).filter(BrollClip.project_id == project_id).count()
    b = BrollClip(project_id=project_id, idx=n, video_url=key,
                  start_ms=start_ms, end_ms=max(end_ms, start_ms + 300),
                  x_pct=x_pct, y_pct=y_pct, size_pct=size_pct)
    db.add(b)
    db.commit()
    db.refresh(b)
    return _broll_out(b)


@router.patch("/{project_id}/brolls/{broll_id}", response_model=BrollOut)
def update_broll(project_id: str, broll_id: str, body: BrollPatch,
    db: Session = Depends(get_db), _owner: Project = Depends(owned_project)):
    b = (db.query(BrollClip)
           .filter(BrollClip.project_id == project_id, BrollClip.id == broll_id).first())
    if b is None:
        raise HTTPException(404, "broll not found")
    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(b, field, val)
    db.commit()
    db.refresh(b)
    return _broll_out(b)


@router.post("/{project_id}/brolls/{broll_id}/replace", response_model=BrollOut)
async def replace_broll(project_id: str, broll_id: str, file: UploadFile = File(...),
    db: Session = Depends(get_db), _owner: Project = Depends(owned_project)):
    """Swap a video clip's source footage, keeping its timeline position/effects."""
    b = (db.query(BrollClip)
           .filter(BrollClip.project_id == project_id, BrollClip.id == broll_id).first())
    if b is None:
        raise HTTPException(404, "clip not found")
    suffix = os.path.splitext(file.filename or "")[1] or ".mp4"
    fd, tmp = tempfile.mkstemp(suffix=suffix)
    with os.fdopen(fd, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            f.write(chunk)
    try:
        key = storage.save_upload(tmp, file.filename or "clip" + suffix)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    b.video_url = key
    db.commit(); db.refresh(b)
    return _broll_out(b)


@router.delete("/{project_id}/brolls/{broll_id}")
def delete_broll(project_id: str, broll_id: str, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    b = (db.query(BrollClip)
           .filter(BrollClip.project_id == project_id, BrollClip.id == broll_id).first())
    if b is None:
        raise HTTPException(404, "broll not found")
    db.delete(b)
    db.commit()
    return {"ok": True}


class DuplicateClipIn(BaseModel):
    start_ms: int = 0
    end_ms: int = 0
    at_ms: int | None = None


@router.post("/{project_id}/duplicate-clip", response_model=BrollOut)
def duplicate_clip(project_id: str, body: DuplicateClipIn, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    """Duplicate a slice of the main video as a standalone clip placed on its own
    video (B-roll) track, so it overlays the main video for its span and can be
    dragged along the timeline. Mirrors HyproAI's 'duplicate to a new track'."""
    proj = db.get(Project, project_id)
    if proj is None or not proj.source_media_url:
        raise HTTPException(404, "project media not found")
    s0 = max(0, int(body.start_ms)); e0 = int(body.end_ms)
    if e0 <= s0 + 100:
        raise HTTPException(400, "invalid clip range")
    try:
        src = storage.path(proj.source_media_url)
    except Exception:
        raise HTTPException(404, "source media unavailable")
    fd, tmp = tempfile.mkstemp(suffix=".mp4")
    os.close(fd)
    try:
        ffmpeg_utils.trim_clip(src, tmp, s0, e0)
        key = storage.save_upload(tmp, "duplicate.mp4")
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    at = int(body.at_ms) if body.at_ms is not None else s0
    length = e0 - s0
    n = db.query(BrollClip).filter(BrollClip.project_id == project_id).count()
    maxtrack = db.query(func.max(BrollClip.track)).filter(BrollClip.project_id == project_id).scalar() or 0
    b = BrollClip(project_id=project_id, idx=n, video_url=key, track=int(maxtrack) + 1,
                  start_ms=at, end_ms=at + length, x_pct=0.0, y_pct=0.0, size_pct=100.0, keep_audio=True)
    db.add(b); db.commit(); db.refresh(b)
    return _broll_out(b)


class ImageFromUrlIn(BaseModel):
    url: str
    start_ms: int = 0
    end_ms: int = 3000
    x_pct: float = 50.0
    y_pct: float = 20.0
    size_pct: float = 40.0


@router.post("/{project_id}/images/from-url", response_model=ImageOut)
def add_image_from_url(project_id: str, body: ImageFromUrlIn, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    if not body.url.startswith(("http://", "https://")):
        raise HTTPException(400, "invalid url")
    try:
        with httpx.Client(timeout=30, follow_redirects=True) as c:
            r = c.get(body.url)
        if r.status_code >= 400:
            raise HTTPException(400, "could not fetch image")
        data = r.content
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, "could not fetch image")
    ct = (r.headers.get("content-type") or "").lower()
    ext = ".png" if "png" in ct else ".webp" if "webp" in ct else ".jpg"
    fd, tmp = tempfile.mkstemp(suffix=ext)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    try:
        key = storage.save_upload(tmp, "stock" + ext)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    n = db.query(ImageOverlay).filter(ImageOverlay.project_id == project_id).count()
    o = ImageOverlay(project_id=project_id, idx=n, image_url=key,
                     start_ms=body.start_ms, end_ms=max(body.end_ms, body.start_ms + 300),
                     x_pct=body.x_pct, y_pct=body.y_pct, size_pct=body.size_pct)
    db.add(o)
    db.commit()
    db.refresh(o)
    return _img_out(o)


class BrollFromUrlIn(BaseModel):
    url: str
    start_ms: int = 0
    end_ms: int = 4000
    x_pct: float = 0.0
    y_pct: float = 0.0
    size_pct: float = 100.0


@router.post("/{project_id}/brolls/from-url", response_model=BrollOut)
def add_broll_from_url(project_id: str, body: BrollFromUrlIn, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    if not body.url.startswith(("http://", "https://")):
        raise HTTPException(400, "invalid url")
    try:
        with httpx.Client(timeout=90, follow_redirects=True) as c:
            r = c.get(body.url)
        if r.status_code >= 400:
            raise HTTPException(400, "could not fetch video")
        data = r.content
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, "could not fetch video")
    fd, tmp = tempfile.mkstemp(suffix=".mp4")
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    try:
        key = storage.save_upload(tmp, "stock.mp4")
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    n = db.query(BrollClip).filter(BrollClip.project_id == project_id).count()
    b = BrollClip(project_id=project_id, idx=n, video_url=key,
                  start_ms=body.start_ms, end_ms=max(body.end_ms, body.start_ms + 300),
                  x_pct=body.x_pct, y_pct=body.y_pct, size_pct=body.size_pct)
    db.add(b)
    db.commit()
    db.refresh(b)
    return _broll_out(b)


# ---------------------------------------------------------------------------
# Audio enhance — run the "studio voice" noise-cleanup on demand (the Apply
# button in the editor's Audio tab). Produces a cleaned AAC audio track the
# editor can play back in preview, and remembers it so export reuses it.
# ---------------------------------------------------------------------------
class EnhanceAudioIn(BaseModel):
    strength: int = 50


@router.post("/{project_id}/enhance-audio")
def enhance_audio(project_id: str, body: EnhanceAudioIn,
                  db: Session = Depends(get_db),
                  _owner: Project = Depends(owned_project)):
    from app.services import ffmpeg_utils
    from app.config import settings

    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    if not project.source_media_url:
        raise HTTPException(400, "this project has no audio to clean yet")

    try:
        strength = max(0, min(100, int(body.strength)))
    except Exception:
        strength = 50

    try:
        src = storage.path(project.source_media_url)
    except Exception:
        raise HTTPException(400, "could not read the project's media")

    af = ffmpeg_utils.audio_enhance_filter(ffmpeg_utils.default_denoise_model(), strength)
    fd, out_tmp = tempfile.mkstemp(suffix=".m4a")
    os.close(fd)
    try:
        cp = ffmpeg_utils._run([
            "ffmpeg", "-y", "-i", src, "-vn",
            "-af", af, "-c:a", "aac", "-b:a", "192k", out_tmp,
        ])
        if cp.returncode != 0 or not os.path.exists(out_tmp) or os.path.getsize(out_tmp) == 0:
            tail = (cp.stderr or "")[-300:]
            raise HTTPException(500, f"audio enhance failed: {tail}")
        with open(out_tmp, "rb") as f:
            data = f.read()
        key = f"enhanced/{project_id}_{strength}.m4a"
        storage.write_bytes(key, data)
        ms = ffmpeg_utils.probe_duration_ms(out_tmp) or 0
    finally:
        if os.path.exists(out_tmp):
            try:
                os.remove(out_tmp)
            except Exception:
                pass

    return {"url": storage.url(key), "ms": ms, "strength": strength}
