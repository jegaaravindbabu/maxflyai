"""
Animated caption styles (line + word-by-word presets), parity with maxfly.ai captions.

Each preset renders to ASS override tags, so the SAME style previews live in the
editor (CSS) and burns identically into the exported MP4 (libass via ffmpeg).

ASS colours are &HAABBGGRR. Word-by-word ("karaoke") styles compute per-word
timing by splitting each cue's duration across its words.
"""
from __future__ import annotations

import functools
import logging
import re
import subprocess

logger = logging.getLogger(__name__)

# palette (BGR hex)
WHITE = "&H00FFFFFF"
BLACK = "&H00000000"
YELLOW = "&H0000FFFF"
ACCENT = "&H003C5AFF"      # orange #FF5A3C
CYAN = "&H00FFFF4C"        # #4C8DFF-ish
BOX = "&H80000000"         # semi-transparent black
DIMWHITE = "&H00CCCCCC"
ORANGE = "&H001A7AFF"      # #FF7A1A
PINK   = "&H00A34FFF"      # #FF4FA3
GREEN  = "&H006AE82E"      # #2EE86A
PURPLE = "&H00FF5CB1"      # #B15CFF
BLUE   = "&H00F6823B"      # sapphire #3B82F6
GOLD   = "&H0018C5F5"      # #F5C518
EMERALD= "&H008AD910"      # #10D98A
CORAL  = "&H003D6BFF"      # #FF6B3D

# ---- Font availability: fall back cleanly instead of libass silently
# swapping a missing display font for a plain serif/Arial. Each display font
# maps to an ordered chain of acceptable substitutes; the first one actually
# installed (per fontconfig) wins, and the substitution is logged.
_FONT_FALLBACKS = {
    "Anton":       ["Anton", "Oswald", "Archivo Black", "Arial Black", "DejaVu Sans"],
    "Bebas Neue":  ["Bebas Neue", "Oswald", "Archivo Narrow", "Arial Narrow", "DejaVu Sans Condensed"],
    "Pacifico":    ["Pacifico", "Dancing Script", "Comic Sans MS", "DejaVu Sans"],
    "Poppins":     ["Poppins", "Montserrat", "Nunito Sans", "DejaVu Sans"],
    "Montserrat":  ["Montserrat", "Poppins", "Nunito Sans", "DejaVu Sans"],
    "Arial Black": ["Arial Black", "Archivo Black", "DejaVu Sans"],
    "Arial":       ["Arial", "Liberation Sans", "DejaVu Sans", "Helvetica"],
    "Oswald":         ["Oswald", "Bebas Neue", "Archivo Narrow", "DejaVu Sans"],
    "Bangers":        ["Bangers", "Luckiest Guy", "Anton", "DejaVu Sans"],
    "Fredoka":        ["Fredoka", "Poppins", "Nunito Sans", "DejaVu Sans"],
    "Luckiest Guy":   ["Luckiest Guy", "Bangers", "Anton", "DejaVu Sans"],
    "Permanent Marker": ["Permanent Marker", "Pacifico", "Comic Sans MS", "DejaVu Sans"],
    "Righteous":      ["Righteous", "Poppins", "DejaVu Sans"],
    "Alfa Slab One":  ["Alfa Slab One", "Archivo Black", "Arial Black", "DejaVu Sans"],
    "Titan One":      ["Titan One", "Fredoka", "Archivo Black", "DejaVu Sans"],
    "Kanit":          ["Kanit", "Poppins", "DejaVu Sans"],
    "Archivo Black":  ["Archivo Black", "Arial Black", "DejaVu Sans"],
    "Caveat":         ["Caveat", "Pacifico", "Dancing Script", "DejaVu Sans"],
    "Lato":           ["Lato", "Nunito Sans", "DejaVu Sans"],
    "Rubik":          ["Rubik", "Montserrat", "DejaVu Sans"],
    "Teko":           ["Teko", "Oswald", "Bebas Neue", "DejaVu Sans"],
}
_DEFAULT_FALLBACK = ["DejaVu Sans", "Liberation Sans", "Arial"]


@functools.lru_cache(maxsize=1)
def _installed_fonts() -> frozenset:
    """Lowercased family names fontconfig knows on this machine (empty if fc-list
    is unavailable, in which case font resolution is skipped)."""
    try:
        out = subprocess.run(["fc-list", ":", "family"],
                             capture_output=True, text=True, timeout=10).stdout
    except Exception as e:                 # fc-list missing / errored -> skip check
        logger.warning("fc-list unavailable, skipping caption font check: %s", e)
        return frozenset()
    fams = set()
    for line in out.splitlines():
        for fam in line.split(","):
            f = fam.strip().lower()
            if f:
                fams.add(f)
    return frozenset(fams)


def resolve_font(desired: str) -> str:
    """Return an installed font family for `desired`, walking its fallback chain.
    Falls through to a generic sans (DejaVu/Liberation) rather than letting libass
    pick an arbitrary default. If fontconfig can't be queried, returns `desired`."""
    fonts = _installed_fonts()
    if not fonts or not desired:
        return desired
    if desired.lower() in fonts:
        return desired
    for cand in _FONT_FALLBACKS.get(desired, []) + _DEFAULT_FALLBACK:
        if cand.lower() in fonts:
            logger.info("caption font %r not installed — falling back to %r", desired, cand)
            return cand
    logger.warning("caption font %r not installed and no fallback found; leaving as-is", desired)
    return desired


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
    "whiteout":     {"label": "Whiteout",         "font": "Arial Black", "size": 78, "bold": -1, "primary": WHITE,   "secondary": DIMWHITE, "outline": BLACK,   "back": "&H00000000", "border_style": 1, "outline_w": 5, "shadow": 2, "anim": "pop", "upper": True},
    "sapphire":     {"label": "Sapphire Script",  "font": "Pacifico",    "size": 76, "bold": 0,  "primary": WHITE,   "secondary": BLUE,     "outline": BLACK,   "back": BOX,          "border_style": 1, "outline_w": 3, "shadow": 2, "anim": "fade"},
    "gold_rush":    {"label": "Gold Rush",        "font": "Anton",       "size": 84, "bold": 0,  "primary": WHITE,   "secondary": GOLD,     "outline": BLACK,   "back": BOX,          "border_style": 1, "outline_w": 5, "shadow": 2, "anim": "pop", "upper": True},
    "neon_emerald": {"label": "Neon Emerald",     "font": "Montserrat",  "size": 68, "bold": 0,  "primary": EMERALD, "secondary": WHITE,    "outline": EMERALD, "back": "&H00000000", "border_style": 1, "outline_w": 2, "shadow": 0, "anim": "glow"},
    "sunset_script":{"label": "Sunset Script",    "font": "Pacifico",    "size": 76, "bold": 0,  "primary": CORAL,   "secondary": WHITE,    "outline": BLACK,   "back": BOX,          "border_style": 1, "outline_w": 3, "shadow": 2, "anim": "fade"},
    "ceyonai_special":{"label": "ceyonai Special","font": "Montserrat",  "size": 70, "bold": 0,  "primary": WHITE,   "secondary": ORANGE,   "outline": BLACK,   "back": BOX,          "border_style": 1, "outline_w": 3, "shadow": 1, "anim": "fade"},
    # ---- word-by-word ("Words" tab): each spoken word highlights via \kf ----
    "word_sunset": {"label": "Sunset script words", "font": "Pacifico",     "size": 74, "bold": 0,  "primary": ORANGE, "secondary": WHITE,    "outline": BLACK, "back": BOX, "border_style": 1, "outline_w": 3, "shadow": 2, "anim": "karaoke"},
    "word_outline":{"label": "Outline caps",        "font": "Arial Black",  "size": 72, "bold": -1, "primary": YELLOW, "secondary": WHITE,    "outline": BLACK, "back": BOX, "border_style": 1, "outline_w": 6, "shadow": 1, "anim": "karaoke", "upper": True},
    "word_neon":   {"label": "Neon words",          "font": "Arial",        "size": 66, "bold": -1, "primary": CYAN,   "secondary": WHITE,    "outline": CYAN,  "back": BOX, "border_style": 1, "outline_w": 2, "shadow": 0, "anim": "karaoke"},
    "word_gold":   {"label": "Gold pop words",      "font": "Anton",        "size": 82, "bold": 0,  "primary": YELLOW, "secondary": WHITE,    "outline": BLACK, "back": BOX, "border_style": 1, "outline_w": 5, "shadow": 2, "anim": "karaoke", "upper": True},
    "word_green":  {"label": "Bold green words",    "font": "Montserrat",   "size": 66, "bold": 0,  "primary": GREEN,  "secondary": WHITE,    "outline": BLACK, "back": BOX, "border_style": 1, "outline_w": 4, "shadow": 1, "anim": "karaoke"},
    "word_bubble": {"label": "Bubble words",        "font": "Arial Black",  "size": 70, "bold": -1, "primary": PINK,   "secondary": WHITE,    "outline": BLACK, "back": BOX, "border_style": 1, "outline_w": 6, "shadow": 1, "anim": "karaoke"},
    "word_mono":   {"label": "Mono caps words",     "font": "Bebas Neue",   "size": 88, "bold": 0,  "primary": CYAN,   "secondary": WHITE,    "outline": BLACK, "back": BOX, "border_style": 1, "outline_w": 3, "shadow": 1, "anim": "karaoke", "upper": True},
    "word_purple": {"label": "Purple words",        "font": "Poppins",      "size": 66, "bold": 0,  "primary": PURPLE, "secondary": WHITE,    "outline": BLACK, "back": BOX, "border_style": 1, "outline_w": 4, "shadow": 1, "anim": "karaoke"},
    "word_marker": {"label": "Marker caps",        "font": "Arial Black", "size": 68, "bold": -1, "primary": BLACK,       "secondary": "&H80000000", "outline": "&H0000FFFF", "back": "&H0000FFFF", "border_style": 3, "outline_w": 4, "shadow": 0, "anim": "karaoke", "upper": True},
    "word_ghost":  {"label": "Ghost outline",      "font": "Arial Black", "size": 72, "bold": -1, "primary": "&HFFFFFFFF", "secondary": "&H80FFFFFF", "outline": WHITE,        "back": "&H00000000", "border_style": 1, "outline_w": 4, "shadow": 0, "anim": "karaoke", "upper": True},
    "word_comic":  {"label": "Yellow comic pop",   "font": "Anton",       "size": 82, "bold": 0,  "primary": YELLOW,      "secondary": WHITE,        "outline": BLACK,        "back": "&H00000000", "border_style": 1, "outline_w": 6, "shadow": 2, "anim": "karaoke", "upper": True},
    "word_hlbox":  {"label": "Purple highlight box","font": "Montserrat", "size": 66, "bold": 0,  "primary": WHITE,       "secondary": WHITE,        "outline": PURPLE,       "back": PURPLE,       "border_style": 3, "outline_w": 4, "shadow": 0, "anim": "karaoke"},
}

DEFAULT = "classic"


def _ms_to_ass(ms: int) -> str:
    ms = max(ms, 0)
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:d}:{m:02d}:{s:02d}.{ms // 10:02d}"


def _header(p: dict, spacing: float = 0.0,
            margin_l: int = 80, margin_r: int = 80, margin_v: int = 90,
            italic: int = 0, underline: int = 0, alignment: int = 2) -> str:
    return (
        "[Script Info]\n"
        "ScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 2\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
        "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
        "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Default,{p['font']},{p['size']},{p['primary']},{p['secondary']},{p['outline']},"
        f"{p['back']},{p['bold']},{italic},{underline},0,100,100,{spacing:g},0,{p['border_style']},{p['outline_w']},"
        f"{p['shadow']},{alignment},{margin_l},{margin_r},{margin_v},1\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )


def _anim_prefix(anim: str | None, dur_ms: int, speed: float = 1.0) -> str:
    """Entrance-animation ASS override tags. `speed` scales the timing (higher = faster)."""
    sp = max(0.3, min(float(speed or 1.0), 4.0))
    d = lambda ms: max(20, int(ms / sp))
    if anim in (None, "none"):
        return ""
    if anim == "fade":
        return f"{{\\fad({d(180)},{d(120)})}}"
    if anim == "slide_up":
        return f"{{\\an2\\move(960,1010,960,970,0,{d(220)})\\fad({d(150)},0)}}"
    if anim == "slide_down":
        return f"{{\\an2\\move(960,930,960,970,0,{d(220)})\\fad({d(150)},0)}}"
    if anim == "slide_left":
        return f"{{\\move(1120,960,960,960,0,{d(240)})\\fad({d(150)},0)}}"
    if anim == "slide_right":
        return f"{{\\move(800,960,960,960,0,{d(240)})\\fad({d(150)},0)}}"
    if anim == "pop":
        return f"{{\\fscx60\\fscy60\\t(0,{d(140)},\\fscx100\\fscy100)\\fad({d(80)},{d(60)})}}"
    if anim == "bounce":
        return f"{{\\fscx115\\fscy115\\t(0,{d(90)},\\fscx95\\fscy95)\\t({d(90)},{d(180)},\\fscx100\\fscy100)}}"
    if anim == "rotate":
        return f"{{\\frz-25\\t(0,{d(220)},\\frz0)\\fad({d(120)},0)}}"
    if anim == "flip":
        return f"{{\\fry90\\t(0,{d(220)},\\fry0)\\fad({d(80)},0)}}"
    if anim == "fade_blur":
        return f"{{\\blur6\\fad({d(200)},{d(120)})\\t(0,{d(220)},\\blur0)}}"
    if anim == "type_on":
        return f"{{\\fad({d(90)},{d(60)})\\fscx92\\t(0,{d(140)},\\fscx100)}}"
    if anim == "type_expand":
        return f"{{\\fsp16\\fad({d(120)},{d(80)})\\t(0,{d(240)},\\fsp0)}}"
    if anim == "scale":
        return f"{{\\fscx70\\fscy70\\t(0,{d(170)},\\fscx100\\fscy100)\\fad({d(90)},{d(60)})}}"
    if anim == "bounce_drop":
        return f"{{\\an2\\move(960,930,960,970,0,{d(240)})\\fscy115\\t(0,{d(120)},\\fscy94)\\t({d(120)},{d(240)},\\fscy100)\\fad({d(80)},0)}}"
    if anim == "glow":
        return "{\\blur4}"
    return ""


def _case_str(t: str, mode) -> str:
    if mode == "upper": return t.upper()
    if mode == "lower": return t.lower()
    if mode == "title": return t.title()
    return t


def _alpha_hex(op):
    """0..100 opacity -> ASS alpha hex ("00" opaque .. "FF" clear); None if unset."""
    if op is None:
        return None
    try:
        a = max(0, min(255, 255 - round(float(op) * 2.55)))
        return "%02X" % a
    except Exception:
        return None


def _wmatch(w: str, emph: str) -> bool:
    if not emph or w == "\\N":
        return False
    return re.sub(r"[^\w]", "", w, flags=re.UNICODE).lower() == emph.lower()


def _karaoke_text(text: str, dur_ms: int, emph: str = "", accent: str = "", primary: str = "",
                  case=None, alpha=None, base_alpha: str = "00") -> str:
    """Split cue into words with per-word \\kf timing (centiseconds)."""
    plain = text.replace("\n", " \\N ")
    words = [w for w in plain.split(" ") if w != ""]
    real = [w for w in words if w != "\\N"]
    if not real:
        return text.replace("\n", "\\N")
    total_chars = sum(len(w) for w in real) or 1
    total_cs = max(dur_ms // 10, len(real))
    o_extra = "\\1c" + accent + "&" + ("\\alpha&H" + alpha + "&" if alpha else "")
    c_extra = "\\1c" + primary + "&" + ("\\alpha&H" + base_alpha + "&" if alpha else "")
    out = []
    used = 0
    for w in words:
        if w == "\\N":
            out.append("\\N")
            continue
        share = round(total_cs * len(w) / total_chars)
        share = max(1, min(share, total_cs - used))
        used += share
        if _wmatch(w, emph):
            out.append("{\\kf" + str(share) + o_extra + "}" + _case_str(w, case) + "{" + c_extra + "} ")
        else:
            out.append("{\\kf" + str(share) + "}" + w + " ")
    return "".join(out).strip()


# Motion presets that animate each word in individually (word scope).
_WORD_MOTION = {"fade", "slide_up", "slide_down", "slide_left", "slide_right",
                "pop", "bounce", "rotate", "flip",
                "fade_blur", "type_on", "type_expand", "scale", "bounce_drop"}


def _word_tag(anim: str, ti: int, D: int) -> str:
    """ASS override for one word's entrance starting at `ti` ms over `D` ms."""
    t2 = ti + D
    if anim == "pop":
        return (f"{{\\fscx45\\fscy45\\alpha&HFF&"
                f"\\t({ti},{t2},\\fscx100\\fscy100\\alpha&H00&)}}")
    if anim == "bounce":
        d1 = ti + int(D * 0.55)
        return (f"{{\\fscx45\\fscy45\\alpha&HFF&"
                f"\\t({ti},{d1},\\fscx112\\fscy112\\alpha&H00&)"
                f"\\t({d1},{t2},\\fscx100\\fscy100)}}")
    if anim == "rotate":
        return f"{{\\frz-14\\alpha&HFF&\\t({ti},{t2},\\frz0\\alpha&H00&)}}"
    if anim == "flip":
        return f"{{\\fry90\\alpha&HFF&\\t({ti},{t2},\\fry0\\alpha&H00&)}}"
    if anim == "fade_blur":
        return f"{{\\blur6\\alpha&HFF&\\t({ti},{t2},\\blur0\\alpha&H00&)}}"
    if anim == "type_expand":
        return f"{{\\fsp14\\alpha&HFF&\\t({ti},{t2},\\fsp0\\alpha&H00&)}}"
    if anim == "scale":
        return f"{{\\fscx60\\fscy60\\alpha&HFF&\\t({ti},{t2},\\fscx100\\fscy100\\alpha&H00&)}}"
    if anim == "bounce_drop":
        d1 = ti + int((t2 - ti) * 0.55)
        return (f"{{\\fscy55\\alpha&HFF&\\t({ti},{d1},\\fscy112\\alpha&H00&)"
                f"\\t({d1},{t2},\\fscy100)}}")
    # type_on + fade + all slide_* fall back to a clean per-word fade-in (cascade = typewriter feel)
    return f"{{\\alpha&HFF&\\t({ti},{t2},\\alpha&H00&)}}"


def _word_anim_text(text: str, dur_ms: int, anim: str, speed: float = 1.0, emph: str = "", accent: str = "", primary: str = "",
                    case=None, alpha=None, base_alpha: str = "00") -> str:
    """Each word animates in on its own, timed across the cue duration."""
    plain = text.replace("\n", " \\N ")
    words = [w for w in plain.split(" ") if w != ""]
    real = [w for w in words if w != "\\N"]
    if not real:
        return text.replace("\n", "\\N")
    total_chars = sum(len(w) for w in real) or 1
    D = max(80, int(220 / max(0.3, speed)))
    o_extra = "\\1c" + accent + "&" + ("\\alpha&H" + alpha + "&" if alpha else "")
    c_extra = "\\1c" + primary + "&" + ("\\alpha&H" + base_alpha + "&" if alpha else "")
    out = []
    used = 0
    for w in words:
        if w == "\\N":
            out.append("\\N")
            continue
        ti = int(dur_ms * used / total_chars)
        used += len(w)
        wtxt = ("{" + o_extra + "}" + _case_str(w, case) + "{" + c_extra + "}") if _wmatch(w, emph) else w
        out.append(_word_tag(anim, ti, D) + wtxt + " ")
    return "".join(out).strip()


_ANIM_RESET = "{\\fscx100\\fscy100\\alpha&H00&\\blur0\\fsp0\\frz0\\fry0}"


def _single_anim_text(text: str, dur_ms: int, anim: str, speed: float = 1.0, emph: str = "",
                      accent: str = "", primary: str = "", case=None, alpha=None, base_alpha: str = "00") -> str:
    """Only the emphasised / selected word animates; the rest appear immediately."""
    if not emph:
        return _word_anim_text(text, dur_ms, anim, speed, emph, accent, primary, case, alpha, base_alpha)
    plain = text.replace("\n", " \\N ")
    words = [w for w in plain.split(" ") if w != ""]
    D = max(80, int(280 / max(0.3, speed)))
    out = []
    for w in words:
        if w == "\\N":
            out.append("\\N"); continue
        if _wmatch(w, emph):
            out.append(_word_tag(anim, 0, D) + _case_str(w, case) + _ANIM_RESET + " ")
        else:
            out.append(_case_str(w, case) + " ")
    return "".join(out).strip()


def _line_anim_text(text: str, dur_ms: int, anim: str, speed: float = 1.0, emph: str = "",
                    accent: str = "", primary: str = "", case=None, alpha=None, base_alpha: str = "00") -> str:
    """Each line animates in separately, staggered across the cue."""
    lines = text.split("\n")
    n = max(1, len(lines))
    D = max(120, int(320 / max(0.3, speed)))
    gap = int(dur_ms * 0.22) if n > 1 else 0
    out = []
    for i, ln in enumerate(lines):
        ti = min(i * gap, max(0, dur_ms - D))
        out.append(_word_tag(anim, ti, D) + _case_str(ln, case) + _ANIM_RESET)
    return "\\N".join(out)


def _emphasize(text: str, word: str, accent: str, primary: str,
               case=None, alpha=None, base_alpha: str = "00",
               big_size=None, big_glow: bool = False, base_size=None) -> str:
    """Colour a whole-word match (case-insensitive) with the accent, then reset.
    Optionally bump the emphasized word's size and/or add a glow (reset after)."""
    if not word:
        return text
    _on = ""
    _off = ""
    if big_size and base_size:
        try:
            _on += "\\fs" + str(int(float(big_size))); _off += "\\fs" + str(int(base_size))
        except Exception:
            pass
    if big_glow:
        _on += "\\blur4"; _off += "\\blur0"
    o_extra = "\\1c" + accent + "&" + ("\\alpha&H" + alpha + "&" if alpha else "") + _on
    c_extra = "\\1c" + primary + "&" + ("\\alpha&H" + base_alpha + "&" if alpha else "") + _off
    def repl(m):
        return "{" + o_extra + "}" + _case_str(m.group(0), case) + "{" + c_extra + "}"
    try:
        return re.sub(r"(?<!\w)" + re.escape(word) + r"(?!\w)", repl, text, flags=re.IGNORECASE)
    except re.error:
        return text


def _ass_color(hexstr):
    """#RRGGBB (or #RGB) -> ASS &H00BBGGRR. Returns None if not a valid hex."""
    if not hexstr:
        return None
    try:
        h = str(hexstr).strip().lstrip("#")
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        if len(h) != 6:
            return None
        r, g, b = h[0:2], h[2:4], h[4:6]
        return ("&H00" + b + g + r).upper()
    except Exception:
        return None


def _cap_inline(delta: dict) -> str:
    """Inline ASS override tags for a single caption's per-caption style delta.
    Only the keys present in `delta` are emitted, so an empty delta -> "" and the
    caption renders identically to the global style."""
    if not delta:
        return ""
    t = ""
    if delta.get("font"):
        t += "\\fn" + resolve_font(delta["font"])
    if delta.get("size"):
        try: t += "\\fs" + str(int(float(delta["size"])))
        except Exception: pass
    _c = _ass_color(delta.get("text_color"))
    if _c:
        t += "\\1c" + _c + "&"
    if delta.get("weight") is not None:
        try: t += "\\b" + ("1" if int(delta["weight"]) >= 600 else "0")
        except Exception: pass
    elif delta.get("bold") is not None:
        t += "\\b" + ("1" if delta["bold"] == -1 else "0")
    if delta.get("italic") is not None:
        t += "\\i" + ("1" if delta["italic"] else "0")
    if delta.get("underline") is not None:
        t += "\\u" + ("1" if delta["underline"] else "0")
    if delta.get("align"):
        t += "\\an" + str({"left": 1, "center": 2, "right": 3}.get(delta["align"], 2))
    if delta.get("letter_gap") is not None:
        try: t += "\\fsp" + ("%g" % float(delta["letter_gap"]))
        except Exception: pass
    if delta.get("glow"):
        t += "\\blur3"
    return t


def _word_override_body(txt: str, wov: dict, primary: str, base_size: int, case=None) -> str:
    """Render a caption body with per-word overrides (colour / size / glow).
    Words are indexed globally across the caption, matching the editor's
    `text.split(/\s+/)` indexing; newlines become ASS line breaks."""
    parts = re.split(r"(\s+)", txt)
    gi = 0
    out = []
    for part in parts:
        if part == "":
            continue
        if part.strip() == "":
            out.append("\\N" if "\n" in part else " ")
            continue
        w = _case_str(part, case)
        wd = wov.get(str(gi))
        gi += 1
        if wd:
            on = ""
            _c = _ass_color(wd.get("color"))
            if _c:
                on += "\\1c" + _c + "&"
            if wd.get("size"):
                try: on += "\\fs" + str(int(float(wd["size"])))
                except Exception: pass
            if wd.get("glow"):
                on += "\\blur4"
            if on:
                reset = "\\1c" + primary + "&\\fs" + str(int(base_size)) + "\\blur0"
                out.append("{" + on + "}" + w + "{" + reset + "}")
            else:
                out.append(w)
        else:
            out.append(w)
    return "".join(out)


def _word_override_split(txt: str, wov: dict, primary: str, base_size: int, case=None):
    """Like _word_override_body but pulls MOVED words (x/y set) out of the flow:
    they become an invisible placeholder inline (so the line keeps its layout) plus
    an entry in `moved` that the caller renders as a separately positioned event."""
    parts = re.split(r"(\s+)", txt)
    gi = 0
    out = []
    moved = []
    for part in parts:
        if part == "":
            continue
        if part.strip() == "":
            out.append("\\N" if "\n" in part else " ")
            continue
        w = _case_str(part, case)
        wd = wov.get(str(gi))
        gi += 1
        if wd and wd.get("x") is not None and wd.get("y") is not None:
            out.append("{\\alpha&HFF&}" + w + "{\\alpha&H00&}")
            moved.append((w, wd))
            continue
        if wd:
            on = ""
            _c = _ass_color(wd.get("color"))
            if _c:
                on += "\\1c" + _c + "&"
            if wd.get("size"):
                try: on += "\\fs" + str(int(float(wd["size"])))
                except Exception: pass
            if wd.get("glow"):
                on += "\\blur4"
            if on:
                reset = "\\1c" + primary + "&\\fs" + str(int(base_size)) + "\\blur0"
                out.append("{" + on + "}" + w + "{" + reset + "}")
            else:
                out.append(w)
        else:
            out.append(w)
    return "".join(out), moved


def _word_pos_event(w: str, wd: dict, primary: str, base_size: int, layer: int,
                    start_ass: str, end_ass: str) -> str:
    """A single moved word rendered as its own centre-anchored, positioned event."""
    try:
        x = int(float(wd["x"]) / 100.0 * 1920)
        y = int(float(wd["y"]) / 100.0 * 1080)
    except Exception:
        x, y = 960, 540
    tag = "\\an5\\pos(%d,%d)" % (x, y)
    _c = _ass_color(wd.get("color"))
    if _c:
        tag += "\\1c" + _c + "&"
    sz = wd.get("size") or base_size
    try:
        tag += "\\fs" + str(int(float(sz)))
    except Exception:
        pass
    if wd.get("glow"):
        tag += "\\blur4"
    return f"Dialogue: {layer},{start_ass},{end_ass},Default,,0,0,0,,{{{tag}}}{w}"


def build_ass(cues: list[dict], style: str = DEFAULT, use_translit: bool = False,
              settings: dict | None = None, overrides: dict | None = None) -> str:
    p = dict(PRESETS.get(style, PRESETS[DEFAULT]))   # copy so overrides don't mutate presets
    spacing = 0.0
    anim = p.get("anim")
    speed = 1.0
    glow = False
    scope = "caption"
    st = settings or {}
    if st.get("font"):
        p["font"] = st["font"]
    p["font"] = resolve_font(p["font"])
    if st.get("bold") is not None:
        p["bold"] = st["bold"]
    if st.get("weight") is not None:
        try:
            p["bold"] = -1 if int(st["weight"]) >= 600 else 0
        except Exception:
            pass
    if st.get("outline_w") is not None:
        p["outline_w"] = st["outline_w"]
    if st.get("shadow") is not None:
        p["shadow"] = st["shadow"]
    if st.get("size"):
        try:
            p["size"] = int(float(st["size"]))
        except Exception:
            pass
    _tc = _ass_color(st.get("text_color"))
    if _tc:
        p["primary"] = _tc
    _hc = _ass_color(st.get("highlight_color"))
    if _hc:
        p["secondary"] = _hc
    _hb = _ass_color(st.get("highlight_box"))
    if _hb:
        p["back"] = _hb
        p["border_style"] = 3
        p["outline_w"] = max(int(p.get("outline_w", 3) or 3), 4)
    spacing = float(st.get("spacing", 0) or 0)
    glow = bool(st.get("glow"))
    speed = float(st.get("speed", 1.0) or 1.0)
    scope = st.get("scope", "caption")
    if st.get("anim_enabled") is False:
        anim = None
    elif st.get("anim"):
        anim = st["anim"]

    # ---- maxfly.ai-parity caption-settings: case / opacity / position / gaps / layer ----
    if st.get("letter_gap") is not None:
        spacing = float(st.get("letter_gap") or 0)
    case_mode = st.get("case")  # None|"as_typed"|"upper"|"lower"|"title"
    pos_v = int(st.get("pos_v") or 0)          # +up
    pos_h = int(st.get("pos_h") or 0)          # +right
    margin_v = max(0, 90 + pos_v)
    margin_l = max(0, 80 + max(0, pos_h))
    margin_r = max(0, 80 + max(0, -pos_h))
    op = st.get("opacity")
    base_alpha = _alpha_hex(op) or "00"
    alpha_tag = ("{\\alpha&H%s&}" % base_alpha) if (op is not None and base_alpha != "00") else ""
    layer = 1 if (st.get("layer") == "front") else 0
    # HyproAI-parity extras: alignment / italic / underline / background box / emphasized word
    italic = 1 if st.get("italic") else 0
    underline = 1 if st.get("underline") else 0
    alignment = {"left": 1, "center": 2, "right": 3}.get(st.get("align") or "center", 2)
    if st.get("background"):
        p["border_style"] = 3
        p["back"] = "&H80000000"
    emph_color = _ass_color(st.get("emph_color"))
    big_size = st.get("big_size")
    big_glow = bool(st.get("big_glow"))
    # Big word (emphasis) + Top line (first line of a 2-line caption) per-part styling
    big_case = st.get("big_case")
    big_alpha = _alpha_hex(st.get("big_opacity"))
    top_case = st.get("top_case")
    top_alpha = _alpha_hex(st.get("top_opacity"))

    def _case(t: str) -> str:
        if case_mode == "upper" or (case_mode is None and p.get("upper")):
            return t.upper()
        if case_mode == "lower":
            return t.lower()
        if case_mode == "title":
            return t.title()
        return t   # as typed

    lines = [_header(p, spacing, margin_l, margin_r, margin_v, italic, underline, alignment)]
    glow_tag = alpha_tag + ("{\\blur3}" if glow else "")
    _ov = overrides or {}
    _cap_ovs = _ov.get("caption") or {}
    _word_ovs = _ov.get("words") or {}
    for _i, c in enumerate(cues):
        _cidx = str(c.get("oidx", c.get("idx", _i)))
        _cap_ov = _cap_ovs.get(_cidx) or {}
        _word_ov = _word_ovs.get(_cidx) or {}
        _cap_pre = _cap_inline(_cap_ov)
        _base_size = int(float(_cap_ov["size"])) if _cap_ov.get("size") else p["size"]
        txt = (c.get("translit_text") if use_translit and c.get("translit_text") else c["text"]) or ""
        txt = _case(txt)
        # Top line = first line of a two-line caption. Case is safe in every mode;
        # opacity is applied inline in the plain/whole-caption path only (karaoke and
        # per-word paths tokenise on spaces, so an inline alpha span there would break
        # the per-word timing tags).
        _karaoke_mode = (anim == "karaoke") or (scope in ("word", "single", "line") and anim in _WORD_MOTION)
        if ("\n" in txt) and (top_case in ("upper", "lower", "title") or top_alpha):
            _first, _rest = txt.split("\n", 1)
            _first = _case_str(_first, top_case)
            if top_alpha and not _karaoke_mode:
                _first = "{\\alpha&H" + top_alpha + "&}" + _first + "{\\alpha&H" + base_alpha + "&}"
            txt = _first + "\n" + _rest
        dur = max(c["end_ms"] - c["start_ms"], 1)
        em = (st.get("emphasis") or "").strip()
        emcol = emph_color or (YELLOW if p["primary"] == ACCENT else ACCENT)
        if anim == "karaoke":
            body = _karaoke_text(txt, dur, em, emcol, p["primary"], big_case, big_alpha, base_alpha)
            prefix = glow_tag + "{\\fad(80,80)}"
        elif scope in ("word", "single", "line") and anim in _WORD_MOTION:
            if scope == "single":
                body = _single_anim_text(txt, dur, anim, speed, em, emcol, p["primary"], big_case, big_alpha, base_alpha)
            elif scope == "line":
                body = _line_anim_text(txt, dur, anim, speed, em, emcol, p["primary"], big_case, big_alpha, base_alpha)
            else:
                body = _word_anim_text(txt, dur, anim, speed, em, emcol, p["primary"], big_case, big_alpha, base_alpha)
            prefix = glow_tag
        _moved = []
        if anim == "karaoke" or (scope in ("word", "single", "line") and anim in _WORD_MOTION):
            pass  # body/prefix already set above
        else:
            if _word_ov:
                body, _moved = _word_override_split(txt, _word_ov, p["primary"], _base_size)
                if em:
                    body = _emphasize(body, em, emcol, p["primary"], big_case, big_alpha, base_alpha, big_size=big_size, big_glow=big_glow, base_size=_base_size)
            else:
                body = txt.replace("\n", "\\N")
                if em:
                    body = _emphasize(body, em, emcol, p["primary"], big_case, big_alpha, base_alpha, big_size=big_size, big_glow=big_glow, base_size=p["size"])
            prefix = glow_tag + _anim_prefix(anim, dur, speed)
        if _cap_pre:
            prefix = "{" + _cap_pre + "}" + prefix
        _sa, _ea = _ms_to_ass(c['start_ms']), _ms_to_ass(c['end_ms'])
        lines.append(f"Dialogue: {layer},{_sa},{_ea},Default,,0,0,0,,{prefix}{body}")
        for _mw, _mwd in _moved:
            lines.append(_word_pos_event(_mw, _mwd, p["primary"], _base_size, (layer or 0) + 5, _sa, _ea))
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
