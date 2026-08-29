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
  status: string;
  error?: string | null;
  created_at?: string | null;
}

export interface ProjectDetail extends Project {
  media_url?: string | null;
  segments: Segment[];
  cues: Cue[];
  language_code?: string | null;
  mode?: string | null;
}
