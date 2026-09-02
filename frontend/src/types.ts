export interface Segment {
  idx: number;
  text: string;
  translit_text?: string | null;
  start_ms: number;
  end_ms: number;
  speaker?: string | null;
  confidence?: number | null;
}

export interface Cue {
  idx: number;
  start_ms: number;
  end_ms: number;
  text: string;
  translit_text?: string | null;
  line_count: number;
}

export interface Project {
  id: string;
  name: string;
  source_media_url?: string | null;
  source_filename?: string | null;
  duration_ms?: number | null;
  size_bytes?: number | null;
  status: string;
  error?: string | null;
  created_at?: string | null;
  sub_count?: number | null;
}

export interface Overlay {
  id: string;
  idx: number;
  text: string;
  start_ms: number;
  end_ms: number;
  x_pct: number;
  y_pct: number;
  font_size: number;
  color: string;
  bold: boolean;
}

export interface ImageOverlay {
  id: string;
  idx: number;
  image_url: string;
  start_ms: number;
  end_ms: number;
  x_pct: number;
  y_pct: number;
  size_pct: number;
}

export interface BrollClip {
  id: string;
  idx: number;
  video_url: string;
  start_ms: number;
  end_ms: number;
  x_pct: number;
  y_pct: number;
  size_pct: number;
}

export interface ProjectDetail extends Project {
  media_url?: string | null;
  segments: Segment[];
  cues: Cue[];
  overlays?: Overlay[];
  images?: ImageOverlay[];
  brolls?: BrollClip[];
  language_code?: string | null;
  mode?: string | null;
}
