"""Transcription pipeline task (non-destructive: writes immutable transcript+segments,
then derives caption cues)."""
from __future__ import annotations

import os
import tempfile

from celery import shared_task

from app.database import SessionLocal
from app.models import Project, Transcript, Segment, CaptionCue, Job
from app.services import ffmpeg_utils, sarvam, segmentation, billing
from app.services.captions import build_cues_from_segments, CuePrefs
from app.services.storage import storage


def _attach_translit_proportional(segments: list[dict], translit_full: str) -> None:
    """Distribute a full romanized string across segments by char fraction.
    Approximate (Sarvam gives no aligned word-level translit); good enough for v1."""
    translit_full = " ".join((translit_full or "").split())
    if not translit_full:
        return
    total_chars = sum(len(s["text"]) for s in segments) or 1
    words = translit_full.split(" ")
    cursor = 0
    for s in segments:
        frac = len(s["text"]) / total_chars
        take = max(1, round(len(words) * frac))
        s["translit_text"] = " ".join(words[cursor:cursor + take])
        cursor += take
    # dump any remainder onto the last segment
    if cursor < len(words) and segments:
        segments[-1]["translit_text"] = (
            (segments[-1].get("translit_text") or "") + " " + " ".join(words[cursor:])
        ).strip()


def run_transcription(project_id: str, language_code: str = "unknown",
                      mode: str = "transcribe", model: str = "saaras:v3",
                      want_translit: bool = True,
                      max_chars: int = 42, min_dur_ms: int = 800,
                      gap_ms: int = 0, single_word: bool = False) -> dict:
    db = SessionLocal()
    job = Job(project_id=project_id, kind="transcribe", status="running")
    db.add(job)
    project = db.get(Project, project_id)
    if project is None:
        db.close()
        raise ValueError("project not found")
    project.status = "transcribing"
    db.commit()

    audio_path = None
    try:
        media_path = storage.path(project.source_media_url)
        duration_ms = project.duration_ms or ffmpeg_utils.probe_duration_ms(media_path) or 0
        project.duration_ms = duration_ms

        audio_path = ffmpeg_utils.extract_audio(media_path)

        raw, chunk_segments = sarvam.transcribe_media(
            audio_path, duration_ms=duration_ms,
            language_code=language_code, mode=mode, model=model,
        )
        full_text = raw.get("transcript", "") or ""

        # optional Thanglish / romanized pass (best-effort)
        translit_full = None
        if want_translit and model.startswith("saaras:v3") and mode == "transcribe":
            try:
                if duration_ms and duration_ms <= sarvam.REST_MAX_MS:
                    tr_raw = sarvam.transcribe_rest(
                        audio_path, language_code=language_code,
                        mode="translit", model=model, with_timestamps=False)
                else:
                    tr_raw = sarvam.transcribe_batch(
                        audio_path, language_code=language_code, mode="translit", model=model)
                translit_full = tr_raw.get("transcript", "")
            except Exception:
                pass

        # Sarvam gives ~one timestamp for the whole request, so derive cue timing
        # ourselves from silence-anchored segmentation of the accurate transcript.
        segments = segmentation.timed_segments_from_transcript(
            audio_path, duration_ms, full_text, translit_full)
        if not segments:
            segments = chunk_segments  # fallback to Sarvam's single chunk

        transcript = Transcript(
            project_id=project_id, language_code=raw.get("language_code") or language_code,
            mode=mode, provider="sarvam",
            provider_job_id=raw.get("request_id"), raw_json=raw,
        )
        db.add(transcript)
        db.flush()

        for seg in segments:
            db.add(Segment(
                transcript_id=transcript.id, idx=seg["idx"], text=seg["text"],
                translit_text=seg.get("translit_text"),
                start_ms=seg["start_ms"], end_ms=seg["end_ms"],
                speaker=seg.get("speaker"),
            ))

        # derive + persist cues (regenerable)
        db.query(CaptionCue).filter(CaptionCue.project_id == project_id).delete()
        cues = build_cues_from_segments(segments, CuePrefs(
            max_chars=max_chars, min_dur_ms=min_dur_ms,
            gap_ms=gap_ms, single_word=single_word))
        for c in cues:
            db.add(CaptionCue(
                project_id=project_id, idx=c.idx, start_ms=c.start_ms, end_ms=c.end_ms,
                text=c.text, translit_text=c.translit_text, line_count=c.line_count,
            ))

        project.status = "ready"
        job.status = "done"
        db.commit()
        # meter processing minutes (billable) for the owner
        if project.user_id:
            try:
                billing.record_usage(db, project.user_id, project_id, duration_ms)
            except Exception:
                pass
        return {"transcript_id": transcript.id, "segments": len(segments), "cues": len(cues)}
    except Exception as e:
        db.rollback()
        project = db.get(Project, project_id)
        if project:
            project.status = "error"
            project.error = str(e)[:1000]
        job.status = "error"
        job.error = str(e)[:1000]
        db.commit()
        raise
    finally:
        if audio_path and os.path.exists(audio_path):
            os.remove(audio_path)
        db.close()


@shared_task(name="maxfly.transcribe")
def transcribe_task(project_id: str, language_code: str = "unknown",
                    mode: str = "transcribe", model: str = "saaras:v3",
                    want_translit: bool = True, max_chars: int = 42,
                    min_dur_ms: int = 800, gap_ms: int = 0,
                    single_word: bool = False) -> dict:
    return run_transcription(project_id, language_code, mode, model, want_translit,
                             max_chars, min_dur_ms, gap_ms, single_word)
