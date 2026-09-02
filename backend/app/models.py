"""
Non-destructive data model.

Source of truth is immutable after ingest:
  - transcripts + segments (timed transcript units) are never mutated.
Edits (silence cuts, retake removals, caption text edits) live in `edits`
as a layered decision list. caption_cues are DERIVED and regenerated.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Column, String, Integer, Float, DateTime, ForeignKey, Text, JSON, Boolean
)
from sqlalchemy.orm import relationship

from app.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Project(Base):
    __tablename__ = "projects"
    id = Column(String, primary_key=True, default=_uuid)
    user_id = Column(String, nullable=True, index=True)  # Supabase auth uid later
    name = Column(String, nullable=False, default="Untitled")
    source_media_url = Column(String, nullable=True)   # stored media key/url
    source_filename = Column(String, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    size_bytes = Column(Integer, nullable=True)
    # uploaded | transcribing | ready | exporting | error
    status = Column(String, nullable=False, default="uploaded")
    error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)

    transcripts = relationship("Transcript", back_populates="project", cascade="all, delete-orphan")
    cues = relationship("CaptionCue", back_populates="project", cascade="all, delete-orphan")
    edits = relationship("Edit", back_populates="project", cascade="all, delete-orphan")
    exports = relationship("Export", back_populates="project", cascade="all, delete-orphan")
    jobs = relationship("Job", back_populates="project", cascade="all, delete-orphan")
    overlays = relationship("TextOverlay", back_populates="project", cascade="all, delete-orphan")
    images = relationship("ImageOverlay", back_populates="project", cascade="all, delete-orphan")
    brolls = relationship("BrollClip", back_populates="project", cascade="all, delete-orphan")


class Transcript(Base):
    """Immutable ASR output for one (language, mode) pass."""
    __tablename__ = "transcripts"
    id = Column(String, primary_key=True, default=_uuid)
    project_id = Column(String, ForeignKey("projects.id"), index=True, nullable=False)
    language_code = Column(String, nullable=True)
    mode = Column(String, nullable=False, default="transcribe")   # transcribe|translit|codemix|...
    provider = Column(String, nullable=False, default="sarvam")
    provider_job_id = Column(String, nullable=True)
    raw_json = Column(JSON, nullable=True)     # full provider response, for auditing
    created_at = Column(DateTime(timezone=True), default=_now)

    project = relationship("Project", back_populates="transcripts")
    segments = relationship("Segment", back_populates="transcript", cascade="all, delete-orphan")


class Segment(Base):
    """
    A timed transcript unit. Sarvam returns CHUNK-level timing (sentence/phrase),
    so a segment is typically a phrase. Kept immutable; `translit_text` holds the
    romanized/Thanglish form when available.
    """
    __tablename__ = "segments"
    id = Column(String, primary_key=True, default=_uuid)
    transcript_id = Column(String, ForeignKey("transcripts.id"), index=True, nullable=False)
    idx = Column(Integer, nullable=False)
    text = Column(Text, nullable=False, default="")
    translit_text = Column(Text, nullable=True)
    start_ms = Column(Integer, nullable=False, default=0)
    end_ms = Column(Integer, nullable=False, default=0)
    speaker = Column(String, nullable=True)
    confidence = Column(Float, nullable=True)

    transcript = relationship("Transcript", back_populates="segments")


class CaptionCue(Base):
    """DERIVED display cues (regenerated from segments + enabled edits)."""
    __tablename__ = "caption_cues"
    id = Column(String, primary_key=True, default=_uuid)
    project_id = Column(String, ForeignKey("projects.id"), index=True, nullable=False)
    idx = Column(Integer, nullable=False)
    start_ms = Column(Integer, nullable=False)
    end_ms = Column(Integer, nullable=False)
    text = Column(Text, nullable=False, default="")
    translit_text = Column(Text, nullable=True)
    line_count = Column(Integer, nullable=False, default=1)

    project = relationship("Project", back_populates="cues")


class Edit(Base):
    """The non-destructive edit layer applied over the immutable transcript."""
    __tablename__ = "edits"
    id = Column(String, primary_key=True, default=_uuid)
    project_id = Column(String, ForeignKey("projects.id"), index=True, nullable=False)
    # silence_cut | retake_remove | caption_edit | manual_cut
    type = Column(String, nullable=False)
    payload_json = Column(JSON, nullable=False, default=dict)
    enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=_now)

    project = relationship("Project", back_populates="edits")


class Export(Base):
    __tablename__ = "exports"
    id = Column(String, primary_key=True, default=_uuid)
    project_id = Column(String, ForeignKey("projects.id"), index=True, nullable=False)
    format = Column(String, nullable=False)   # srt|vtt|ass|mp4|fcpxml|edl
    url = Column(String, nullable=True)
    status = Column(String, nullable=False, default="ready")
    error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)

    project = relationship("Project", back_populates="exports")


class Job(Base):
    """UI-facing mirror of async work."""
    __tablename__ = "jobs"
    id = Column(String, primary_key=True, default=_uuid)
    project_id = Column(String, ForeignKey("projects.id"), index=True, nullable=False)
    kind = Column(String, nullable=False)   # transcribe|export|silence|...
    status = Column(String, nullable=False, default="queued")  # queued|running|done|error
    error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)

    project = relationship("Project", back_populates="jobs")


class Subscription(Base):
    __tablename__ = "subscriptions"
    id = Column(String, primary_key=True, default=_uuid)
    user_id = Column(String, nullable=False, index=True)
    plan = Column(String, nullable=False, default="free")        # free|starter|creator|pro
    status = Column(String, nullable=False, default="active")    # active|canceled|past_due
    provider = Column(String, nullable=True)                     # mock|razorpay
    provider_customer_id = Column(String, nullable=True)
    provider_sub_id = Column(String, nullable=True)
    current_period_start = Column(DateTime(timezone=True), default=_now)
    current_period_end = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)


class UsageEvent(Base):
    __tablename__ = "usage_events"
    id = Column(String, primary_key=True, default=_uuid)
    user_id = Column(String, nullable=False, index=True)
    project_id = Column(String, nullable=True)
    kind = Column(String, nullable=False, default="transcription")
    minutes = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), default=_now)


class TextOverlay(Base):
    """Custom on-screen text / title (separate from captions). Burned in at export."""
    __tablename__ = "text_overlays"
    id = Column(String, primary_key=True, default=_uuid)
    project_id = Column(String, ForeignKey("projects.id"), index=True, nullable=False)
    idx = Column(Integer, nullable=False, default=0)
    text = Column(Text, nullable=False, default="")
    start_ms = Column(Integer, nullable=False, default=0)
    end_ms = Column(Integer, nullable=False, default=3000)
    x_pct = Column(Float, nullable=False, default=50.0)   # centre X, 0-100 of frame width
    y_pct = Column(Float, nullable=False, default=20.0)   # centre Y, 0-100 of frame height
    font_size = Column(Integer, nullable=False, default=72)
    color = Column(String, nullable=False, default="#ffffff")   # hex RRGGBB
    bold = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=_now)

    project = relationship("Project", back_populates="overlays")


class ImageOverlay(Base):
    """Image / B-roll still overlaid on the video for a time range. Burned in at export."""
    __tablename__ = "image_overlays"
    id = Column(String, primary_key=True, default=_uuid)
    project_id = Column(String, ForeignKey("projects.id"), index=True, nullable=False)
    idx = Column(Integer, nullable=False, default=0)
    image_url = Column(String, nullable=False)          # storage key
    start_ms = Column(Integer, nullable=False, default=0)
    end_ms = Column(Integer, nullable=False, default=3000)
    x_pct = Column(Float, nullable=False, default=50.0)  # top-left anchor fraction (0-100)
    y_pct = Column(Float, nullable=False, default=20.0)
    size_pct = Column(Float, nullable=False, default=40.0)  # width as % of frame width
    created_at = Column(DateTime(timezone=True), default=_now)

    project = relationship("Project", back_populates="images")


class BrollClip(Base):
    """A second video clip (B-roll) overlaid on the main video for a time range.
    Burned in at export; main audio is kept, B-roll is muted."""
    __tablename__ = "broll_clips"
    id = Column(String, primary_key=True, default=_uuid)
    project_id = Column(String, ForeignKey("projects.id"), index=True, nullable=False)
    idx = Column(Integer, nullable=False, default=0)
    video_url = Column(String, nullable=False)          # storage key
    start_ms = Column(Integer, nullable=False, default=0)
    end_ms = Column(Integer, nullable=False, default=3000)
    x_pct = Column(Float, nullable=False, default=0.0)   # top-left anchor fraction (0-100)
    y_pct = Column(Float, nullable=False, default=0.0)
    size_pct = Column(Float, nullable=False, default=100.0)  # width as % of frame width
    created_at = Column(DateTime(timezone=True), default=_now)

    project = relationship("Project", back_populates="brolls")
