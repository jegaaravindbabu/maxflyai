"""
Stem / layer separation for multi-track export.

Produces separate media layers rendered to the FINAL cut timeline:
  - video (no audio)
  - voice  (the main/enhanced audio — the dialogue layer)
  - music  (instrumental / background)

True AI voice/music separation needs a model (Demucs). Without one we use
ffmpeg-only approximations:
  - music stem: stereo center-cancel (L-R) removes mono-centered vocals -> instrumental
  - voice stem: the (optionally enhanced) main mix

If DEMUCS is configured (settings.demucs_enabled + demucs installed), that path
can be swapped in for true stems. All stems are cut to `keep` intervals so the
layers line up on the exported timeline.
"""
from __future__ import annotations

import os
import subprocess

from app.services import ffmpeg_utils


def _run(cmd: list[str]):
    return subprocess.run(cmd, capture_output=True, text=True)


def _trim_expr(keep: list[dict]) -> tuple[str, str]:
    """Return (video_select, audio_select) filter fragments for keep intervals."""
    # between(t,a,b) unions
    conds = "+".join(f"between(t,{k['start_ms']/1000:.3f},{k['end_ms']/1000:.3f})" for k in keep)
    return f"select='{conds}',setpts=N/FRAME_RATE/TB", f"aselect='{conds}',asetpts=N/SR/TB"


def has_stereo(media_path: str) -> bool:
    cp = _run(["ffprobe", "-v", "quiet", "-select_streams", "a:0",
               "-show_entries", "stream=channels", "-of", "csv=p=0", media_path])
    try:
        return int(cp.stdout.strip() or "0") >= 2
    except ValueError:
        return False


def render_video_only(media_path: str, keep: list[dict], out_path: str) -> str:
    vsel, _ = _trim_expr(keep)
    cp = _run(["ffmpeg", "-y", "-i", media_path, "-an",
               "-vf", vsel, "-c:v", "libx264", "-pix_fmt", "yuv420p", out_path])
    if cp.returncode != 0:
        raise RuntimeError(f"video-only render failed: {cp.stderr[-400:]}")
    return out_path


def render_voice(media_path: str, keep: list[dict], out_path: str,
                 audio_filter: str | None = None) -> str:
    _, asel = _trim_expr(keep)
    chain = asel + (("," + audio_filter) if audio_filter else "")
    cp = _run(["ffmpeg", "-y", "-i", media_path, "-vn", "-af", chain, out_path])
    if cp.returncode != 0:
        raise RuntimeError(f"voice render failed: {cp.stderr[-400:]}")
    return out_path


def render_music(media_path: str, keep: list[dict], out_path: str) -> str | None:
    """Instrumental via stereo center-cancel. Returns None if source is mono."""
    if not has_stereo(media_path):
        return None
    _, asel = _trim_expr(keep)
    # out-of-phase subtraction cancels center (vocals) -> instrumental, then to stereo
    chain = f"{asel},pan=stereo|c0=c0-c1|c1=c1-c0"
    cp = _run(["ffmpeg", "-y", "-i", media_path, "-vn", "-af", chain, out_path])
    if cp.returncode != 0:
        raise RuntimeError(f"music render failed: {cp.stderr[-400:]}")
    return out_path
