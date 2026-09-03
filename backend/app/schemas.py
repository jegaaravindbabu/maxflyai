"""Pydantic API schemas."""
from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel


class SegmentOut(BaseModel):
    idx: int
    text: str
    translit_text: Optional[str] = None
    start_ms: int
    end_ms: int
    speaker: Optional[str] = None
    confidence: Optional[float] = None

    class Config:
        from_attributes = True


class CueOut(BaseModel):
    idx: int
    start_ms: int
    end_ms: int
    text: str
    translit_text: Optional[str] = None
    line_count: int

    class Config:
        from_attributes = True


class ProjectOut(BaseModel):
    id: str
    name: str
    source_media_url: Optional[str] = None
    source_filename: Optional[str] = None
    duration_ms: Optional[int] = None
    size_bytes: Optional[int] = None
    status: str
    error: Optional[str] = None
    created_at: Optional[datetime] = None
    sub_count: Optional[int] = None

    class Config:
        from_attributes = True


class OverlayOut(BaseModel):
    id: str
    idx: int = 0
    text: str = ""
    start_ms: int = 0
    end_ms: int = 3000
    x_pct: float = 50.0
    y_pct: float = 20.0
    font_size: int = 72
    color: str = "#ffffff"
    bold: bool = True

    class Config:
        from_attributes = True


class OverlayIn(BaseModel):
    text: str = ""
    start_ms: int = 0
    end_ms: int = 3000
    x_pct: float = 50.0
    y_pct: float = 20.0
    font_size: int = 72
    color: str = "#ffffff"
    bold: bool = True


class OverlayPatch(BaseModel):
    text: str | None = None
    start_ms: int | None = None
    end_ms: int | None = None
    x_pct: float | None = None
    y_pct: float | None = None
    font_size: int | None = None
    color: str | None = None
    bold: bool | None = None


class ImageOut(BaseModel):
    id: str
    idx: int = 0
    image_url: Optional[str] = None
    start_ms: int = 0
    end_ms: int = 3000
    x_pct: float = 50.0
    y_pct: float = 20.0
    size_pct: float = 40.0


class ImagePatch(BaseModel):
    start_ms: int | None = None
    end_ms: int | None = None
    x_pct: float | None = None
    y_pct: float | None = None
    size_pct: float | None = None


class BrollOut(BaseModel):
    id: str
    idx: int = 0
    video_url: Optional[str] = None
    start_ms: int = 0
    end_ms: int = 3000
    x_pct: float = 0.0
    y_pct: float = 0.0
    size_pct: float = 100.0


class BrollPatch(BaseModel):
    start_ms: int | None = None
    end_ms: int | None = None
    x_pct: float | None = None
    y_pct: float | None = None
    size_pct: float | None = None


class ProjectDetail(ProjectOut):
    media_url: Optional[str] = None
    segments: list[SegmentOut] = []
    cues: list[CueOut] = []
    overlays: list[OverlayOut] = []
    images: list[ImageOut] = []
    brolls: list[BrollOut] = []
    language_code: Optional[str] = None
    mode: Optional[str] = None


class TranscribeRequest(BaseModel):
    language_code: str = "unknown"   # BCP-47 e.g. ta-IN, or "unknown"
    mode: str = "transcribe"         # transcribe|translit|codemix|verbatim|translate
    model: str = "saaras:v3"
    # caption segmentation preferences (New Project modal)
    max_chars: int = 42              # max characters per caption line
    min_dur_secs: float = 0.8        # minimum on-screen duration per cue
    gap_frames: int = 0              # blank gap between cues (frames @30fps)
    layout: str = "double"           # "single" (one word) | "double" (two lines)


class CaptionEditRequest(BaseModel):
    cue_idx: int
    new_text: str


class ExportRequest(BaseModel):
    format: str = "srt"   # srt|vtt|ass|mp4
    use_translit: bool = False
    apply_cuts: bool = True   # apply enabled silence/manual cuts (ripple-delete)
    style: str = "classic"    # caption animation preset (ass/mp4)
    enhance_audio: bool = False   # "studio" voice cleanup on the exported MP4
    volume: float = 1.0       # audio level multiplier (mp4)
    speed: float = 1.0        # playback speed multiplier (mp4)


class JobOut(BaseModel):
    id: str
    kind: str
    status: str
    error: Optional[str] = None

    class Config:
        from_attributes = True
