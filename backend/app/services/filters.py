"""Colour filters / grades applied at MP4 export via built-in ffmpeg video filters.
No external LUT files required.

Two layers, matching the editor UI:
  * a named preset grade (grouped into categories), and
  * manual Adjust values (brightness / contrast / saturation / warmth).
Stored together on one Edit row (type="filter", payload {name, adjust}).
"""
from __future__ import annotations

# preset -> label, group, ffmpeg video-filter string
FILTER_PRESETS: dict[str, dict] = {
    "none":      {"label": "Original",      "group": "",               "vf": None},
    # Clarity boost — punchy, clean looks
    "vivid":     {"label": "Vivid HD",      "group": "Clarity boost",  "vf": "eq=saturation=1.40:contrast=1.12"},
    "bright":    {"label": "Bright",        "group": "Clarity boost",  "vf": "eq=brightness=0.06:contrast=1.05:saturation=1.05"},
    "contrast":  {"label": "Punch",         "group": "Clarity boost",  "vf": "eq=contrast=1.30:saturation=1.08"},
    "sharp":     {"label": "Crisp",         "group": "Clarity boost",  "vf": "eq=contrast=1.12:saturation=1.12,unsharp=5:5:0.8"},
    # Creative grades — mood & colour
    "warm":      {"label": "Warm",          "group": "Creative grades","vf": "eq=gamma_r=1.06:gamma_b=0.94:saturation=1.10"},
    "cool":      {"label": "Cool",          "group": "Creative grades","vf": "eq=gamma_r=0.94:gamma_b=1.08:saturation=1.05"},
    "cinematic": {"label": "Cinematic",     "group": "Creative grades","vf": "eq=contrast=1.10:saturation=0.92:gamma=0.96,colorbalance=rs=0.06:bs=-0.06"},
    "teal":      {"label": "Teal & Orange", "group": "Creative grades","vf": "colorbalance=rs=0.10:bs=-0.10:gs=-0.02:bm=0.06,eq=contrast=1.08:saturation=1.12"},
    "vintage":   {"label": "Vintage",       "group": "Creative grades","vf": "curves=preset=vintage"},
    "bw":        {"label": "Mono",          "group": "Creative grades","vf": "hue=s=0"},
}

# category order + subtitle shown in the editor
GROUPS: list[dict] = [
    {"name": "Clarity boost",   "sub": "Sharper & punchier"},
    {"name": "Creative grades", "sub": "Mood & colour"},
]


def list_presets() -> list[dict]:
    return [{"id": k, "label": v["label"], "group": v["group"]}
            for k, v in FILTER_PRESETS.items()]


def list_groups() -> list[dict]:
    return GROUPS


def filter_string(name: str) -> str | None:
    return FILTER_PRESETS.get(name or "none", FILTER_PRESETS["none"])["vf"]


def _clampi(v, lo, hi):
    try:
        return max(lo, min(hi, int(v)))
    except Exception:
        return 0


def adjust_string(adjust: dict | None) -> str | None:
    """Manual Adjust sliders (-100..100 each) -> one ffmpeg `eq` clause.

    brightness -> eq brightness (-0.30..0.30)
    contrast   -> eq contrast   (0.50..1.50)
    saturation -> eq saturation (0.00..2.00)
    warmth     -> red/blue gamma split (warmer = more red, less blue)
    """
    a = adjust or {}
    b = _clampi(a.get("brightness", 0), -100, 100)
    c = _clampi(a.get("contrast", 0), -100, 100)
    s = _clampi(a.get("saturation", 0), -100, 100)
    w = _clampi(a.get("warmth", 0), -100, 100)
    if not any((b, c, s, w)):
        return None
    parts = []
    if b:
        parts.append(f"brightness={b/100*0.30:.3f}")
    if c:
        parts.append(f"contrast={1 + c/100*0.50:.3f}")
    if s:
        parts.append(f"saturation={1 + s/100*1.00:.3f}")
    if w:
        parts.append(f"gamma_r={1 + w/100*0.15:.3f}")
        parts.append(f"gamma_b={1 - w/100*0.15:.3f}")
    return "eq=" + ":".join(parts)


def combined_vf(name: str, adjust: dict | None) -> str | None:
    """Preset grade + manual Adjust, as a single comma-joined vf chain."""
    preset = filter_string(name)
    adj = adjust_string(adjust)
    chain = [x for x in (preset, adj) if x]
    return ",".join(chain) if chain else None
