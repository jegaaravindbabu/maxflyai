from fastapi import APIRouter, Depends, HTTPException
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
    return q.order_by(Project.created_at.desc()).all()


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
