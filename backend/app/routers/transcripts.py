from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.services.storage import storage  # noqa: F401
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

    # map modal caption prefs -> builder params
    min_dur_ms = max(1, int(round(float(body.min_dur_secs) * 1000)))
    gap_ms = max(0, int(round(int(body.gap_frames) * 1000 / 30)))  # frames @30fps
    single_word = (body.layout == "single")

    if runner.use_celery():
        result = transcribe_task.delay(project_id, body.language_code, body.mode, body.model,
                                       True, body.max_chars, min_dur_ms, gap_ms, single_word)
        return {"status": "transcribing", "task_id": result.id}
    runner.submit(run_transcription, project_id, body.language_code, body.mode, body.model,
                  True, body.max_chars, min_dur_ms, gap_ms, single_word)
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


def _reindex(db, project_id):
    rows = (db.query(CaptionCue)
              .filter(CaptionCue.project_id == project_id)
              .order_by(CaptionCue.start_ms, CaptionCue.idx).all())
    for i, c in enumerate(rows):
        c.idx = i
    db.commit()
    return rows


class AddCueIn(BaseModel):
    start_ms: int
    end_ms: int
    text: str = ""
    translit_text: str | None = None


@router.post("/{project_id}/cues/add")
def add_cue(project_id: str, body: AddCueIn, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    start = max(0, int(body.start_ms))
    end = max(start + 200, int(body.end_ms))
    db.add(CaptionCue(project_id=project_id, idx=10**9, start_ms=start, end_ms=end,
                      text=body.text or "", translit_text=body.translit_text, line_count=1))
    db.commit()
    _reindex(db, project_id)
    return {"ok": True}


class SplitIn(BaseModel):
    split_ms: int | None = None


@router.post("/{project_id}/cues/{cue_idx}/split")
def split_cue(project_id: str, cue_idx: int, body: SplitIn, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    cue = (db.query(CaptionCue)
             .filter(CaptionCue.project_id == project_id, CaptionCue.idx == cue_idx).first())
    if cue is None:
        raise HTTPException(404, "cue not found")
    mid = body.split_ms if (body.split_ms and cue.start_ms < body.split_ms < cue.end_ms)         else (cue.start_ms + cue.end_ms) // 2
    words = (cue.text or "").split()
    half = len(words) // 2 or 1
    first_txt, second_txt = " ".join(words[:half]), " ".join(words[half:])
    tw = (cue.translit_text or "").split()
    th = len(tw) // 2 or 1
    orig_end = cue.end_ms
    cue.end_ms = mid
    cue.text = first_txt
    cue.translit_text = " ".join(tw[:th]) if tw else None
    db.add(CaptionCue(project_id=project_id, idx=10**9, start_ms=mid, end_ms=orig_end,
                      text=second_txt, translit_text=(" ".join(tw[th:]) if tw else None), line_count=1))
    db.commit()
    _reindex(db, project_id)
    return {"ok": True}


class MergeIn(BaseModel):
    cue_idx: int   # merge this cue with the following one


@router.post("/{project_id}/cues/merge")
def merge_cue(project_id: str, body: MergeIn, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    a = (db.query(CaptionCue)
           .filter(CaptionCue.project_id == project_id, CaptionCue.idx == body.cue_idx).first())
    b = (db.query(CaptionCue)
           .filter(CaptionCue.project_id == project_id, CaptionCue.idx == body.cue_idx + 1).first())
    if a is None or b is None:
        raise HTTPException(404, "need two adjacent cues to merge")
    a.text = ((a.text or "") + " " + (b.text or "")).strip()
    if a.translit_text or b.translit_text:
        a.translit_text = ((a.translit_text or "") + " " + (b.translit_text or "")).strip()
    a.end_ms = b.end_ms
    db.delete(b)
    db.commit()
    _reindex(db, project_id)
    return {"ok": True}


@router.delete("/{project_id}/cues/{cue_idx}")
def delete_cue(project_id: str, cue_idx: int, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    cue = (db.query(CaptionCue)
             .filter(CaptionCue.project_id == project_id, CaptionCue.idx == cue_idx).first())
    if cue is None:
        raise HTTPException(404, "cue not found")
    db.delete(cue)
    db.commit()
    _reindex(db, project_id)
    return {"ok": True}


class BulkDeleteIn(BaseModel):
    idxs: list[int]


@router.post("/{project_id}/cues/bulk-delete")
def bulk_delete_cues(project_id: str, body: BulkDeleteIn, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    if body.idxs:
        (db.query(CaptionCue)
           .filter(CaptionCue.project_id == project_id, CaptionCue.idx.in_(body.idxs))
           .delete(synchronize_session=False))
        db.commit()
        _reindex(db, project_id)
    return {"ok": True}


class CueItem(BaseModel):
    start_ms: int
    end_ms: int
    text: str = ""
    translit_text: str | None = None
    line_count: int = 1


class ReplaceCuesIn(BaseModel):
    cues: list[CueItem]


@router.post("/{project_id}/cues/replace")
def replace_cues(project_id: str, body: ReplaceCuesIn, db: Session = Depends(get_db),
    _owner: Project = Depends(owned_project)):
    """Replace the whole cue list (used by editor undo/redo)."""
    db.query(CaptionCue).filter(CaptionCue.project_id == project_id).delete(synchronize_session=False)
    ordered = sorted(body.cues, key=lambda c: c.start_ms)
    for i, c in enumerate(ordered):
        db.add(CaptionCue(project_id=project_id, idx=i, start_ms=c.start_ms,
                          end_ms=max(c.end_ms, c.start_ms + 100), text=c.text,
                          translit_text=c.translit_text, line_count=c.line_count or 1))
    db.commit()
    return {"ok": True, "count": len(ordered)}
