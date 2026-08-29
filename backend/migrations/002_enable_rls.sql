-- RLS lockdown (applied 2026-08-29). Enables Row Level Security with NO policies
-- on all app tables. The FastAPI backend connects as the `postgres` role, which
-- BYPASSES RLS, so it keeps full access; this blocks direct access via the public
-- anon/authenticated keys (Supabase client libs / PostgREST). Add per-user policies
-- later if you ever expose these tables to the client directly.
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caption_cues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
