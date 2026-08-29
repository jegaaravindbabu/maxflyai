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
    status: str
    error: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ProjectDetail(ProjectOut):
    media_url: Optional[str] = None
    segments: list[SegmentOut] = []
    cues: list[CueOut] = []
    language_code: Optional[str] = None
    mode: Optional[str] = None


class TranscribeRequest(BaseModel):
    language_code: str = "unknown"   # BCP-47 e.g. ta-IN, or "unknown"
    mode: str = "transcribe"         # transcribe|translit|codemix|verbatim|translate
    model: str = "saaras:v3"


class CaptionEditRequest(BaseModel):
    cue_idx: int
    new_text: str


class ExportRequest(BaseModel):
    format: str = "srt"   # srt|vtt|ass|mp4
    use_translit: bool = False
    apply_cuts: bool = True   # apply enabled silence/manual cuts (ripple-delete)
    style: str = "classic"    # caption animation preset (ass/mp4)
    enhance_audio: bool = False   # "studio" voice cleanup on the exported MP4


class JobOut(BaseModel):
    id: str
    kind: str
    status: str
    error: Optional[str] = None

    class Config:
        from_attributes = True
