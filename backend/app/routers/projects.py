from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import owned_project
from app.models import Project, Segment, Transcript, CaptionCue, Job, TextOverlay, ImageOverlay, BrollClip
from app.schemas import ProjectOut, ProjectDetail, SegmentOut, CueOut, OverlayOut, OverlayIn, OverlayPatch, ImageOut, ImagePatch, BrollOut, BrollPatch
from app.services.auth import current_user
from app.services.storage import storage
import os, tempfile

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db), user: str | None = Depends(current_user)):
    q = db.query(Project)
    if user is not None:
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


@router.get("/{project_id}", response_model=ProjectDetail)
def get_project(project_id: str, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
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
    detail.brolls = [BrollOut(id=b.id, idx=b.idx, video_url=storage.url(b.video_url),
                              start_ms=b.start_ms, end_ms=b.end_ms, x_pct=b.x_pct,
                              y_pct=b.y_pct, size_pct=b.size_pct) for b in brolls]
    if transcript:
        detail.language_code = transcript.language_code
        detail.mode = transcript.mode
    return detail


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
                    y_pct=b.y_pct, size_pct=b.size_pct)


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
