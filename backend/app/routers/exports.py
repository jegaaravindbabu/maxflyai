from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import owned_project
from app.services.auth import current_user, is_admin
from app.config import settings
from app.models import Project, Export
from app.schemas import ExportRequest
from app.tasks.exporting import run_export_job, export_task
from app import runner

router = APIRouter(prefix="/api/projects", tags=["exports"])


@router.post("/{project_id}/export")
def export(project_id: str, body: ExportRequest, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project),
    user: str | None = Depends(current_user),
    admin: bool = Depends(is_admin)):
    # Per-user cap on simultaneous heavy (MP4) renders so one account can't
    # flood the worker queue. Subtitle exports are instant and not limited;
    # admins and dev/open mode are exempt.
    if body.format == "mp4" and user is not None and not admin:
        active = (db.query(Export)
                    .join(Project, Export.project_id == Project.id)
                    .filter(Project.user_id == user,
                            Export.format == "mp4",
                            Export.status == "processing")
                    .count())
        if active >= settings.max_concurrent_exports:
            raise HTTPException(429, f"You already have {active} exports running. "
                                     "Please wait for one to finish before starting another.")
    # create the export row as "processing", render in the background, return now
    exp = Export(project_id=project_id, format=body.format, status="processing")
    db.add(exp)
    db.commit()
    db.refresh(exp)
    if runner.use_celery():
        export_task.delay(exp.id, project_id, body.format, body.use_translit,
                          body.apply_cuts, body.style, body.enhance_audio,
                          body.volume, body.speed, body.enhance_strength,
                          body.resolution)
    else:
        runner.submit(run_export_job, exp.id, project_id, body.format, body.use_translit,
                      body.apply_cuts, body.style, body.enhance_audio, body.volume, body.speed,
                      body.enhance_strength, body.resolution)
    return {"export_id": exp.id, "status": "processing", "format": body.format}


@router.get("/{project_id}/exports")
def list_exports(project_id: str, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    return (db.query(Export).filter(Export.project_id == project_id)
              .order_by(Export.created_at.desc()).all())
