from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import owned_project
from app.models import Project, CaptionCue
from app.schemas import TranscribeRequest, CaptionEditRequest
from app.tasks.transcribe import transcribe_task, run_transcription
from app.services import billing
from app.services.auth import current_user
from app import runner

router = APIRouter(prefix="/api/projects", tags=["transcripts"])


@router.post("/{project_id}/transcribe")
def transcribe(project_id: str, body: TranscribeRequest, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project), user: str | None = Depends(current_user)):
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    if user is not None:
        ok, info = billing.can_process(db, user, project.duration_ms or 0)
        if not ok:
            raise HTTPException(402, detail={"error": "quota_exceeded", **info})
    if project.status == "transcribing":
        return {"status": "transcribing", "note": "already in progress"}

    # mark queued synchronously, then process OFF the request thread and return now
    project.status = "transcribing"
    project.error = None
    db.commit()

    if runner.use_celery():
        result = transcribe_task.delay(project_id, body.language_code, body.mode, body.model)
        return {"status": "transcribing", "task_id": result.id}
    runner.submit(run_transcription, project_id, body.language_code, body.mode, body.model)
    return {"status": "transcribing"}


@router.patch("/{project_id}/cues")
def edit_cue(project_id: str, body: CaptionEditRequest, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    """Caption text edit. Stored as a derived-cue update; the transcript stays immutable."""
    cue = (db.query(CaptionCue)
             .filter(CaptionCue.project_id == project_id, CaptionCue.idx == body.cue_idx)
             .first())
    if cue is None:
        raise HTTPException(404, "cue not found")
    cue.text = body.new_text
    db.commit()
    return {"ok": True, "cue_idx": body.cue_idx, "text": body.new_text}
