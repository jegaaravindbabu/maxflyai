"""Auto Zoom: generate punch-in zoom segments and build the ffmpeg zoompan filter.

Zoom segments are stored as Edit rows (type="zoom", payload {start_ms,end_ms,scale}).
They are applied only at MP4 export, as a single zoompan filter chained before the
subtitle burn. Time is derived from the output frame index (on/fps) so the expression
is robust across ffmpeg versions.
"""
from __future__ import annotations


def auto_segments(cues: list[dict], duration_ms: int, scale: float = 1.2) -> list[dict]:
    """Pick punch-in windows. Prefer longer caption cues (alternating); fall back to
    evenly spaced windows when there are no usable cues."""
    scale = max(1.05, min(float(scale), 1.6))
    segs: list[dict] = []
    eligible = [c for c in cues if (c.get("end_ms", 0) - c.get("start_ms", 0)) >= 1200]
    for i, c in enumerate(eligible):
        if i % 2 != 0:
            continue
        s = int(c["start_ms"])
        e = min(int(c["end_ms"]), s + 4000)
        if e - s >= 700:
            segs.append({"start_ms": s, "end_ms": e, "scale": scale})
    if not segs and duration_ms and duration_ms > 6000:
        t = 3000
        while t + 2500 < duration_ms:
            segs.append({"start_ms": t, "end_ms": t + 2500, "scale": scale})
            t += 6000
    return segs


def build_zoom_filter(segments: list[dict], width: int, height: int,
                      fps_num: int, fps_den: int) -> str | None:
    """A single zoompan filter that ramps zoom in/out over each segment (centred)."""
    segs = [s for s in segments if s.get("end_ms", 0) > s.get("start_ms", 0)]
    if not segs:
        return None
    fps_val = (fps_num / fps_den) if fps_den else 30.0
    U = f"(on/{fps_val:.5f})"          # current time in seconds
    ramp_s = 0.25                       # ease in/out seconds
    expr = "1"
    for seg in segs:
        s = seg["start_ms"] / 1000.0
        e = seg["end_ms"] / 1000.0
        k = max(1.05, min(float(seg.get("scale", 1.2)), 1.6))
        ramp = (f"(1+({k}-1)"
                f"*clip(({U}-{s:.3f})/{ramp_s},0,1)"
                f"*clip(({e:.3f}-{U})/{ramp_s},0,1))")
        expr = f"if(between({U},{s:.3f},{e:.3f}),{ramp},{expr})"
    return (f"zoompan=z='{expr}'"
            f":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
            f":d=1:fps={fps_num}/{fps_den}:s={width}x{height}")
