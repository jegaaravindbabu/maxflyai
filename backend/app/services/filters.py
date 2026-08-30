"""Colour filters / grades applied at MP4 export via built-in ffmpeg video filters.
No external LUT files required. Stored as an Edit row (type="filter", payload {name})."""
from __future__ import annotations

FILTER_PRESETS: dict[str, dict] = {
    "none":         {"label": "None",          "vf": None},
    "warm":         {"label": "Warm",          "vf": "eq=gamma_r=1.06:gamma_b=0.94:saturation=1.10"},
    "cool":         {"label": "Cool",          "vf": "eq=gamma_r=0.94:gamma_b=1.08:saturation=1.05"},
    "vivid":        {"label": "Vivid",         "vf": "eq=saturation=1.40:contrast=1.12"},
    "cinematic":    {"label": "Cinematic",     "vf": "eq=contrast=1.10:saturation=0.92:gamma=0.96,colorbalance=rs=0.06:bs=-0.06"},
    "vintage":      {"label": "Vintage",       "vf": "curves=preset=vintage"},
    "bw":           {"label": "Black & white", "vf": "hue=s=0"},
    "bright":       {"label": "Bright",        "vf": "eq=brightness=0.06:contrast=1.05:saturation=1.05"},
    "contrast":     {"label": "High contrast", "vf": "eq=contrast=1.30:saturation=1.08"},
}


def list_presets() -> list[dict]:
    return [{"id": k, "label": v["label"]} for k, v in FILTER_PRESETS.items()]


def filter_string(name: str) -> str | None:
    return FILTER_PRESETS.get(name or "none", FILTER_PRESETS["none"])["vf"]
