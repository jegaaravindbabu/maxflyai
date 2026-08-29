-- maxfly.ai initial schema (non-destructive model). Applied to Supabase project
-- "maxfly" (ref eimouchjvvnvcnrrzwmm) on 2026-08-29. Mirrors app/models.py.
create table if not exists projects (
  id text primary key default gen_random_uuid()::text,
  user_id text, name text not null default 'Untitled',
  source_media_url text, source_filename text, duration_ms integer,
  status text not null default 'uploaded', error text,
  created_at timestamptz default now());
create index if not exists ix_projects_user_id on projects(user_id);

create table if not exists transcripts (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references projects(id) on delete cascade,
  language_code text, mode text not null default 'transcribe',
  provider text not null default 'sarvam', provider_job_id text, raw_json jsonb,
  created_at timestamptz default now());
create index if not exists ix_transcripts_project_id on transcripts(project_id);

create table if not exists segments (
  id text primary key default gen_random_uuid()::text,
  transcript_id text not null references transcripts(id) on delete cascade,
  idx integer not null, text text not null default '', translit_text text,
  start_ms integer not null default 0, end_ms integer not null default 0,
  speaker text, confidence double precision);
create index if not exists ix_segments_transcript_id on segments(transcript_id);

create table if not exists caption_cues (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references projects(id) on delete cascade,
  idx integer not null, start_ms integer not null, end_ms integer not null,
  text text not null default '', translit_text text, line_count integer not null default 1);
create index if not exists ix_caption_cues_project_id on caption_cues(project_id);

create table if not exists edits (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references projects(id) on delete cascade,
  type text not null, payload_json jsonb not null default '{}'::jsonb,
  enabled boolean not null default true, created_at timestamptz default now());
create index if not exists ix_edits_project_id on edits(project_id);

create table if not exists exports (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references projects(id) on delete cascade,
  format text not null, url text, status text not null default 'ready',
  created_at timestamptz default now());
create index if not exists ix_exports_project_id on exports(project_id);

create table if not exists jobs (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references projects(id) on delete cascade,
  kind text not null, status text not null default 'queued', error text,
  created_at timestamptz default now());
create index if not exists ix_jobs_project_id on jobs(project_id);
