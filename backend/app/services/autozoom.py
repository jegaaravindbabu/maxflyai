"""Auto Zoom: polished-style punch-in zooms.

Each zoom is stored as an Edit row (type="zoom") with payload:
    start_ms, end_ms      window on the ORIGINAL timeline
    strength              "subtle" | "medium" | "strong"
    scale                 numeric peak zoom (derived from strength; kept explicit
                          so export never has to re-map)
    fx, fy                focus point, 0..1 fractions of the frame (default centre)
    ease_in, ease_out     ramp seconds for the push-in / pull-out
    source                "ai" | "manual"

Zooms are applied only at MP4 export, as a single zoompan filter chained before
the subtitle burn (so captions stay full-size on top of the zoomed video). Time
is derived from the output frame index (on/fps) so the expression is robust
across ffmpeg versions. The pan is aimed at the focus point so the preview
(a CSS transform-origin scale) and the export match pixel-for-pixel.
"""
from __future__ import annotations

# strength label -> peak zoom factor
STRENGTH: dict[str, float] = {"subtle": 1.10, "medium": 1.20, "strong": 1.35}
# speed label -> ramp seconds (how long the push-in / pull-out takes)
SPEED: dict[str, float] = {"fast": 0.15, "medium": 0.35, "slow": 0.70}
# density -> (skip every Nth eligible cue, spacing for the evenly-spaced fallback ms)
DENSITY: dict[str, tuple[int, int]] = {
    "fewer": (3, 9000), "balanced": (2, 6000), "more": (1, 4000),
}


def strength_scale(strength: str, fallback: float = 1.20) -> float:
    return STRENGTH.get(str(strength).lower(), fallback)


def _clampf(v: float, lo: float, hi: float) -> float:
    return max(lo, min(float(v), hi))


def default_zoom(start_ms: int, end_ms: int, strength: str = "medium",
                 source: str = "manual", fx: float = 0.5, fy: float = 0.5,
                 ease_in: str | float = "medium",
                 ease_out: str | float = "medium") -> dict:
    """A fully-formed zoom payload with every field the preview + export read."""
    ei = SPEED.get(str(ease_in).lower(), float(ease_in) if isinstance(ease_in, (int, float)) else 0.35)
    eo = SPEED.get(str(ease_out).lower(), float(ease_out) if isinstance(ease_out, (int, float)) else 0.35)
    st = str(strength).lower()
    if st not in STRENGTH:
        st = "medium"
    return {
        "start_ms": int(start_ms), "end_ms": int(end_ms),
        "strength": st, "scale": strength_scale(st),
        "fx": _clampf(fx, 0.0, 1.0), "fy": _clampf(fy, 0.0, 1.0),
        "ease_in": round(_clampf(ei, 0.05, 1.5), 3),
        "ease_out": round(_clampf(eo, 0.05, 1.5), 3),
        "source": "ai" if source == "ai" else "manual",
    }


def auto_segments(cues: list[dict], duration_ms: int,
                  density: str = "balanced") -> list[dict]:
    """Pick punch-in windows. Prefer longer caption cues (spaced out by density);
    fall back to evenly spaced windows when there are no usable cues."""
    step, spacing = DENSITY.get(str(density).lower(), DENSITY["balanced"])
    segs: list[dict] = []
    eligible = [c for c in cues if (c.get("end_ms", 0) - c.get("start_ms", 0)) >= 1000]
    for i, c in enumerate(eligible):
        if i % step != 0:
            continue
        s = int(c["start_ms"])
        e = min(int(c["end_ms"]), s + 4000)
        if e - s >= 600:
            segs.append(default_zoom(s, e, "medium", source="ai"))
    if not segs and duration_ms and duration_ms > 5000:
        t = 2500
        win = 2500
        while t + win < duration_ms:
            segs.append(default_zoom(t, t + win, "medium", source="ai"))
            t += spacing
    return segs


def build_zoom_filter(segments: list[dict], width: int, height: int,
                      fps_num: int, fps_den: int) -> str | None:
    """A single zoompan filter that ramps the zoom in/out over each segment,
    aimed at each segment's focus point (fx, fy)."""
    segs = [s for s in segments if s.get("end_ms", 0) > s.get("start_ms", 0)]
    if not segs:
        return None
    fps_val = (fps_num / fps_den) if fps_den else 30.0
    U = f"(on/{fps_val:.5f})"          # current time in seconds
    z_expr = "1"
    x_expr = "0"
    y_expr = "0"
    for seg in segs:
        s = seg["start_ms"] / 1000.0
        e = seg["end_ms"] / 1000.0
        k = _clampf(seg.get("scale", strength_scale(seg.get("strength", "medium"))), 1.05, 1.6)
        ein = _clampf(seg.get("ease_in", 0.35), 0.05, 1.5)
        eout = _clampf(seg.get("ease_out", 0.35), 0.05, 1.5)
        fx = _clampf(seg.get("fx", 0.5), 0.0, 1.0)
        fy = _clampf(seg.get("fy", 0.5), 0.0, 1.0)
        cond = f"between({U},{s:.3f},{e:.3f})"
        ramp = (f"(1+({k}-1)"
                f"*clip(({U}-{s:.3f})/{ein:.3f},0,1)"
                f"*clip(({e:.3f}-{U})/{eout:.3f},0,1))")
        z_expr = f"if({cond},{ramp},{z_expr})"
        # keep the focus point fixed on screen while zooming:
        # x = fx*iw*(1 - 1/z),  y = fy*ih*(1 - 1/z)
        x_expr = f"if({cond},({fx:.4f}*iw*(1-1/zoom)),{x_expr})"
        y_expr = f"if({cond},({fy:.4f}*ih*(1-1/zoom)),{y_expr})"
    return (f"zoompan=z='{z_expr}'"
            f":x='{x_expr}':y='{y_expr}'"
            f":d=1:fps={fps_num}/{fps_den}:s={width}x{height}")
