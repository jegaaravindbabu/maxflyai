"""
Animated caption styles (12 presets), parity with HyproAI's caption animations.

Each preset renders to ASS override tags, so the SAME style previews live in the
editor (CSS) and burns identically into the exported MP4 (libass via ffmpeg).

ASS colours are &HAABBGGRR. Word-by-word ("karaoke") styles compute per-word
timing by splitting each cue's duration across its words.
"""
from __future__ import annotations

# palette (BGR hex)
WHITE = "&H00FFFFFF"
BLACK = "&H00000000"
YELLOW = "&H0000FFFF"
ACCENT = "&H003C5AFF"      # orange #FF5A3C
CYAN = "&H00FFFF4C"        # #4C8DFF-ish
BOX = "&H80000000"         # semi-transparent black
DIMWHITE = "&H00CCCCCC"

# preset -> style + per-line animation behavior
PRESETS = {
    "classic":    {"label": "Classic",         "font": "Arial",           "size": 64, "bold": -1, "primary": WHITE,  "secondary": DIMWHITE, "outline": BLACK, "back": BOX,   "border_style": 1, "outline_w": 3, "shadow": 1, "anim": None},
    "boxed":      {"label": "Boxed",            "font": "Arial",           "size": 60, "bold": -1, "primary": WHITE,  "secondary": DIMWHITE, "outline": BLACK, "back": BOX,   "border_style": 3, "outline_w": 6, "shadow": 0, "anim": None},
    "fade":       {"label": "Fade",             "font": "Arial",           "size": 64, "bold": -1, "primary": WHITE,  "secondary": DIMWHITE, "outline": BLACK, "back": BOX,   "border_style": 1, "outline_w": 3, "shadow": 1, "anim": "fade"},
    "slide_up":   {"label": "Slide up",         "font": "Arial",           "size": 64, "bold": -1, "primary": WHITE,  "secondary": DIMWHITE, "outline": BLACK, "back": BOX,   "border_style": 1, "outline_w": 3, "shadow": 1, "anim": "slide_up"},
    "pop":        {"label": "Pop",              "font": "Arial",           "size": 66, "bold": -1, "primary": WHITE,  "secondary": DIMWHITE, "outline": BLACK, "back": BOX,   "border_style": 1, "outline_w": 3, "shadow": 1, "anim": "pop"},
    "bounce":     {"label": "Bounce",           "font": "Arial",           "size": 66, "bold": -1, "primary": WHITE,  "secondary": DIMWHITE, "outline": BLACK, "back": BOX,   "border_style": 1, "outline_w": 3, "shadow": 1, "anim": "bounce"},
    "glow":       {"label": "Neon glow",        "font": "Arial",           "size": 64, "bold": -1, "primary": WHITE,  "secondary": DIMWHITE, "outline": CYAN,  "back": BOX,   "border_style": 1, "outline_w": 2, "shadow": 0, "anim": "glow"},
    "bold_yellow":{"label": "Bold yellow",      "font": "Arial Black",     "size": 76, "bold": -1, "primary": YELLOW, "secondary": DIMWHITE, "outline": BLACK, "back": BOX,   "border_style": 1, "outline_w": 5, "shadow": 2, "anim": "pop"},
    "uppercase":  {"label": "Uppercase punch",  "font": "Arial Black",     "size": 72, "bold": -1, "primary": WHITE,  "secondary": DIMWHITE, "outline": BLACK, "back": BOX,   "border_style": 1, "outline_w": 5, "shadow": 2, "anim": "pop", "upper": True},
    "shadow":     {"label": "Drop shadow",      "font": "Arial",           "size": 64, "bold": -1, "primary": WHITE,  "secondary": DIMWHITE, "outline": BLACK, "back": BLACK, "border_style": 1, "outline_w": 2, "shadow": 4, "anim": None},
    "karaoke":    {"label": "Word-by-word",     "font": "Arial",           "size": 66, "bold": -1, "primary": ACCENT, "secondary": WHITE,    "outline": BLACK, "back": BOX,   "border_style": 1, "outline_w": 3, "shadow": 1, "anim": "karaoke"},
    "highlight":  {"label": "Highlight words",  "font": "Arial Black",     "size": 68, "bold": -1, "primary": YELLOW, "secondary": WHITE,    "outline": BLACK, "back": BOX,   "border_style": 1, "outline_w": 4, "shadow": 1, "anim": "karaoke"},
    "anton":      {"label": "Anton",             "font": "Anton",           "size": 82, "bold": 0,  "primary": WHITE,  "secondary": DIMWHITE, "outline": BLACK, "back": BOX,   "border_style": 1, "outline_w": 5, "shadow": 2, "anim": "pop", "upper": True},
    "anton_gold": {"label": "Anton gold",        "font": "Anton",           "size": 82, "bold": 0,  "primary": YELLOW, "secondary": WHITE,    "outline": BLACK, "back": BOX,   "border_style": 1, "outline_w": 5, "shadow": 2, "anim": "karaoke", "upper": True},
    "bebas":      {"label": "Bebas",             "font": "Bebas Neue",      "size": 88, "bold": 0,  "primary": WHITE,  "secondary": DIMWHITE, "outline": BLACK, "back": BOX,   "border_style": 1, "outline_w": 4, "shadow": 1, "anim": "slide_up", "upper": True},
    "poppins":    {"label": "Poppins bold",      "font": "Poppins",         "size": 66, "bold": 0,  "primary": WHITE,  "secondary": DIMWHITE, "outline": BLACK, "back": BOX,   "border_style": 1, "outline_w": 4, "shadow": 1, "anim": "fade"},
    "montserrat": {"label": "Montserrat",        "font": "Montserrat",      "size": 66, "bold": 0,  "primary": WHITE,  "secondary": DIMWHITE, "outline": BLACK, "back": BOX,   "border_style": 1, "outline_w": 4, "shadow": 1, "anim": "pop"},
    "script":     {"label": "Script",            "font": "Pacifico",        "size": 74, "bold": 0,  "primary": WHITE,  "secondary": DIMWHITE, "outline": BLACK, "back": BOX,   "border_style": 1, "outline_w": 3, "shadow": 2, "anim": "fade"},
    "script_gold":{"label": "Script gold",       "font": "Pacifico",        "size": 74, "bold": 0,  "primary": YELLOW, "secondary": WHITE,    "outline": BLACK, "back": "&H00000000", "border_style": 1, "outline_w": 2, "shadow": 3, "anim": "glow"},
}

DEFAULT = "classic"


def _ms_to_ass(ms: int) -> str:
    ms = max(ms, 0)
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:d}:{m:02d}:{s:02d}.{ms // 10:02d}"


def _header(p: dict) -> str:
    return (
        "[Script Info]\n"
        "ScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 2\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
        "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
        "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Default,{p['font']},{p['size']},{p['primary']},{p['secondary']},{p['outline']},"
        f"{p['back']},{p['bold']},0,0,0,100,100,0,0,{p['border_style']},{p['outline_w']},"
        f"{p['shadow']},2,80,80,90,1\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )


def _anim_prefix(anim: str | None, dur_ms: int) -> str:
    if anim == "fade":
        return "{\\fad(180,120)}"
    if anim == "slide_up":
        return "{\\an2\\move(960,1010,960,970,0,220)\\fad(150,0)}"
    if anim == "pop":
        return "{\\fscx60\\fscy60\\t(0,140,\\fscx100\\fscy100)\\fad(80,60)}"
    if anim == "bounce":
        return "{\\fscx115\\fscy115\\t(0,90,\\fscx95\\fscy95)\\t(90,180,\\fscx100\\fscy100)}"
    if anim == "glow":
        return "{\\blur4}"
    return ""


def _karaoke_text(text: str, dur_ms: int) -> str:
    """Split cue into words with per-word \\kf timing (centiseconds)."""
    plain = text.replace("\n", " \\N ")
    words = [w for w in plain.split(" ") if w != ""]
    real = [w for w in words if w != "\\N"]
    if not real:
        return text.replace("\n", "\\N")
    total_chars = sum(len(w) for w in real) or 1
    total_cs = max(dur_ms // 10, len(real))
    out = []
    used = 0
    for w in words:
        if w == "\\N":
            out.append("\\N")
            continue
        share = round(total_cs * len(w) / total_chars)
        share = max(1, min(share, total_cs - used))
        used += share
        out.append(f"{{\\kf{share}}}{w} ")
    return "".join(out).strip()


def build_ass(cues: list[dict], style: str = DEFAULT, use_translit: bool = False) -> str:
    p = PRESETS.get(style, PRESETS[DEFAULT])
    lines = [_header(p)]
    for c in cues:
        txt = (c.get("translit_text") if use_translit and c.get("translit_text") else c["text"]) or ""
        if p.get("upper"):
            txt = txt.upper()
        dur = max(c["end_ms"] - c["start_ms"], 1)
        if p.get("anim") == "karaoke":
            body = _karaoke_text(txt, dur)
            prefix = "{\\fad(80,80)}"
        else:
            body = txt.replace("\n", "\\N")
            prefix = _anim_prefix(p.get("anim"), dur)
        lines.append(
            f"Dialogue: 0,{_ms_to_ass(c['start_ms'])},{_ms_to_ass(c['end_ms'])},"
            f"Default,,0,0,0,,{prefix}{body}"
        )
    return "\n".join(lines) + "\n"


def list_presets() -> list[dict]:
    return [{"id": k, "label": v["label"],
             "animated": v.get("anim") is not None} for k, v in PRESETS.items()]


def _hex_to_ass(hex_color: str) -> str:
    h = (hex_color or "#ffffff").lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) != 6:
        h = "ffffff"
    rr, gg, bb = h[0:2], h[2:4], h[4:6]
    return f"&H00{bb}{gg}{rr}".upper() + "&"


def build_overlay_events(overlays: list[dict]) -> str:
    """Extra ASS Dialogue lines for positioned text overlays (PlayRes 1920x1080)."""
    out = []
    for o in overlays:
        text = (o.get("text") or "").replace("\n", "\\N")
        if not text.strip():
            continue
        x = round(max(0.0, min(100.0, float(o.get("x_pct", 50)))) / 100.0 * 1920)
        y = round(max(0.0, min(100.0, float(o.get("y_pct", 20)))) / 100.0 * 1080)
        size = int(o.get("font_size", 72))
        colour = _hex_to_ass(o.get("color", "#ffffff"))
        bold = 1 if o.get("bold", True) else 0
        start = _ms_to_ass(int(o.get("start_ms", 0)))
        end = _ms_to_ass(int(o.get("end_ms", 3000)))
        tags = f"{{\\an5\\pos({x},{y})\\fs{size}\\c{colour}\\b{bold}\\bord3\\shad1}}"
        out.append(f"Dialogue: 1,{start},{end},Default,,0,0,0,,{tags}{text}")
    return "\n".join(out)
