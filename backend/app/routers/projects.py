from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import owned_project
from app.models import Project, Segment, Transcript, CaptionCue, Job
from app.schemas import ProjectOut, ProjectDetail, SegmentOut, CueOut
from app.services.auth import current_user
from app.services.storage import storage

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
