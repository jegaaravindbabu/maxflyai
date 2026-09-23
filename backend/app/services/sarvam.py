"""
Sarvam Saaras speech-to-text client.

Verified against docs.sarvam.ai (Aug 2026):
  - REST:  POST https://api.sarvam.ai/speech-to-text
           header: api-subscription-key
           form: file, model(saaras:v3|v4), mode(v3 only), language_code, with_timestamps
           response: {request_id, transcript, language_code, timestamps, language_probability}
           `timestamps` = {words[], start_time_seconds[], end_time_seconds[]} (CHUNK level)
           REST limit: audio <= 30s.
  - BATCH: sarvamai SDK  client.speech_to_text_job.create_job(...)
           .upload_files() .start() .wait_until_complete() .download_outputs()
           files up to ~2h, up to 20/job; diarization via with_diarization/num_speakers.
           Batch is ALSO chunk-level timing per current docs.

NOTE (PRD quality gate): both APIs give chunk-level timestamps, not word-level.
Cue building is designed around timed phrase segments accordingly.
"""
from __future__ import annotations

import glob
import json
import os
import tempfile
import time

import httpx

from app.config import settings

REST_URL = "https://api.sarvam.ai/speech-to-text"
REST_MAX_MS = 30_000
BATCH_MAX_WAIT_S = 2400   # default ceiling; callers pass a duration-scaled value
BATCH_POLL_S = 5

def batch_wait_for(duration_ms: int | None) -> int:
    """Time budget for a batch job, scaled to audio length (Sarvam batch runs at
    roughly real-time or slower), with a floor and a hard ceiling so a genuine hang
    still errors out instead of blocking the worker forever."""
    return min(3600, max(600, int((duration_ms or 0) / 1000 * 4)))


class SarvamError(RuntimeError):
    pass


def _require_key() -> str:
    if not settings.sarvam_api_key:
        raise SarvamError("SARVAM_API_KEY is not set")
    return settings.sarvam_api_key


def _wait_for_job(job, *, max_wait_s: int = BATCH_MAX_WAIT_S, poll_s: int = BATCH_POLL_S) -> None:
    """Bounded wait for a Sarvam batch job. The SDK's wait_until_complete() blocks
    forever when a job fails or stalls, which hangs our single worker and leaves the
    project stuck at 'transcribing'. Poll instead: fail fast on a failed job, and give
    up after max_wait_s so the task errors loudly (project -> error) and can be retried."""
    deadline = time.monotonic() + max_wait_s
    jid = getattr(job, "job_id", "?")
    while True:
        try:
            if job.is_failed():
                raise SarvamError(f"Sarvam batch job failed (job {jid})")
            if job.is_complete():
                return
        except SarvamError:
            raise
        except Exception:
            pass  # transient status-check error; keep polling until the deadline
        if time.monotonic() >= deadline:
            raise SarvamError(
                f"Transcription timed out after {max_wait_s // 60} min. The video may be "
                f"too long, or the speech service is busy - please try again.")
        time.sleep(poll_s)


# ---------------- REST (sync, <=30s) ----------------

def transcribe_rest(audio_path: str, *, language_code: str = "unknown",
                    mode: str = "transcribe", model: str = "saaras:v3",
                    with_timestamps: bool = True) -> dict:
    key = _require_key()
    data = {"model": model, "language_code": language_code, "with_timestamps": str(with_timestamps).lower()}
    if model.startswith("saaras:v3"):
        data["mode"] = mode
    with open(audio_path, "rb") as f:
        files = {"file": (os.path.basename(audio_path), f, "audio/wav")}
        with httpx.Client(timeout=120) as client:
            resp = client.post(REST_URL, headers={"api-subscription-key": key},
                               data=data, files=files)
    if resp.status_code >= 400:
        raise SarvamError(f"Sarvam REST {resp.status_code}: {resp.text[:400]}")
    return resp.json()


def normalize_rest(raw: dict, fallback_end_ms: int) -> list[dict]:
    """Turn a REST response into timed segments [{idx,text,start_ms,end_ms}]."""
    ts = raw.get("timestamps") or {}
    words = ts.get("words") or []
    starts = ts.get("start_time_seconds") or []
    ends = ts.get("end_time_seconds") or []
    segments: list[dict] = []
    if words and len(words) == len(starts) == len(ends):
        for i, (w, s, e) in enumerate(zip(words, starts, ends)):
            segments.append({
                "idx": i,
                "text": (w or "").strip(),
                "start_ms": int(float(s) * 1000),
                "end_ms": int(float(e) * 1000),
            })
    else:
        # no timestamps -> single segment over the whole clip
        segments.append({
            "idx": 0,
            "text": (raw.get("transcript") or "").strip(),
            "start_ms": 0,
            "end_ms": fallback_end_ms,
        })
    return segments


# ---------------- BATCH (async, long files) ----------------

def transcribe_batch(audio_path: str, *, language_code: str = "unknown",
                     mode: str = "transcribe", model: str = "saaras:v3",
                     with_timestamps: bool = True,
                     with_diarization: bool = False,
                     num_speakers: int | None = None,
                     max_wait_s: int = BATCH_MAX_WAIT_S) -> dict:
    """
    Production path for files > 30s. Uses the sarvamai SDK. Returns the parsed
    per-file output JSON (raw). Requires `pip install sarvamai`.
    """
    key = _require_key()
    try:
        from sarvamai import SarvamAI
    except ImportError as e:  # pragma: no cover
        raise SarvamError("sarvamai SDK not installed (pip install sarvamai)") from e

    client = SarvamAI(api_subscription_key=key)
    kwargs = {"model": model, "language_code": language_code}
    if model.startswith("saaras:v3"):
        kwargs["mode"] = mode
    if with_timestamps:
        kwargs["with_timestamps"] = True
    if with_diarization:
        kwargs["with_diarization"] = True
        if num_speakers:
            kwargs["num_speakers"] = num_speakers

    job = client.speech_to_text_job.create_job(**kwargs)
    job.upload_files(file_paths=[audio_path])
    job.start()
    _wait_for_job(job, max_wait_s=max_wait_s)

    out_dir = tempfile.mkdtemp(prefix="sarvam_batch_")
    job.download_outputs(output_dir=out_dir)
    result_files = glob.glob(os.path.join(out_dir, "*.json"))
    if not result_files:
        raise SarvamError("Batch job produced no output files")
    with open(result_files[0], "r", encoding="utf-8") as f:
        return json.load(f)


def normalize_batch(raw: dict, fallback_end_ms: int) -> list[dict]:
    """Batch output is chunk-level; same timestamps shape as REST."""
    return normalize_rest(raw, fallback_end_ms)


# ---------------- high-level dispatch ----------------

def transcribe_media(audio_path: str, *, duration_ms: int,
                     language_code: str = "unknown", mode: str = "transcribe",
                     model: str = "saaras:v3") -> tuple[dict, list[dict]]:
    """Pick REST vs Batch by duration. Returns (raw_response, segments)."""
    if duration_ms and duration_ms <= REST_MAX_MS:
        raw = transcribe_rest(audio_path, language_code=language_code,
                              mode=mode, model=model, with_timestamps=True)
        return raw, normalize_rest(raw, duration_ms or REST_MAX_MS)
    raw = transcribe_batch(audio_path, language_code=language_code,
                           mode=mode, model=model,
                           max_wait_s=batch_wait_for(duration_ms))
    return raw, normalize_batch(raw, duration_ms or REST_MAX_MS)
