from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import owned_project
from app.models import Project, Export
from app.schemas import ExportRequest
from app.tasks.exporting import run_export_job
from app import runner

router = APIRouter(prefix="/api/projects", tags=["exports"])


@router.post("/{project_id}/export")
def export(project_id: str, body: ExportRequest, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    # create the export row as "processing", render in the background, return now
    exp = Export(project_id=project_id, format=body.format, status="processing")
    db.add(exp)
    db.commit()
    db.refresh(exp)
    runner.submit(run_export_job, exp.id, project_id, body.format, body.use_translit,
                  body.apply_cuts, body.style, body.enhance_audio)
    return {"export_id": exp.id, "status": "processing", "format": body.format}


@router.get("/{project_id}/exports")
def list_exports(project_id: str, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    return (db.query(Export).filter(Export.project_id == project_id)
              .order_by(Export.created_at.desc()).all())
