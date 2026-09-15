"""
Text translation for caption tracks, via Sarvam's Translate API (Mayura).
Used to produce a translated caption track (e.g. English) from the existing
caption cues, without re-transcribing. Reuses the same SARVAM_API_KEY.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import httpx

from app.config import settings

TRANSLATE_URL = "https://api.sarvam.ai/translate"

# Mayura-supported language codes (BCP-47, India locales).
SUPPORTED = {
    "en-IN", "hi-IN", "ta-IN", "te-IN", "kn-IN", "ml-IN",
    "mr-IN", "bn-IN", "gu-IN", "pa-IN", "od-IN",
}


class TranslateError(RuntimeError):
    pass


def _one(text: str, target: str, source: str) -> str:
    text = (text or "").strip()
    if not text:
        return ""
    if not settings.sarvam_api_key:
        raise TranslateError("SARVAM_API_KEY is not set")
    body = {
        "input": text[:1900],
        "source_language_code": source or "auto",
        "target_language_code": target,
        "model": "mayura:v1",
    }
    with httpx.Client(timeout=60) as c:
        r = c.post(TRANSLATE_URL, headers={"api-subscription-key": settings.sarvam_api_key}, json=body)
    if r.status_code >= 400:
        raise TranslateError(f"Sarvam translate {r.status_code}: {r.text[:300]}")
    return (r.json().get("translated_text") or "").strip()


def translate_texts(texts: list[str], target: str, source: str | None = None) -> list[str]:
    """Translate a list of short strings (one per cue) into `target`, preserving
    order and count so cue timing stays aligned. Source is auto-detected by default."""
    if target not in SUPPORTED:
        raise TranslateError(f"unsupported target language: {target}")
    out: list[str] = [""] * len(texts)

    def work(i: int) -> None:
        out[i] = _one(texts[i], target, source or "auto")

    with ThreadPoolExecutor(max_workers=6) as ex:
        list(ex.map(work, range(len(texts))))
    return out
