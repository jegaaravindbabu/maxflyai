# maxfly.ai

Browser-based AI video **caption & subtitle editor** for Indian-language creators
(Tamil-first). Upload a video → get accurate captions with per-phrase timing in 7
languages plus romanized **Thanglish**, edit non-destructively, and export
SRT/VTT/ASS, burned-in MP4, and editable timelines (FCPXML/EDL) for Premiere & DaVinci.

ASR is powered by **Sarvam Saaras**. See `PRD.md` for the full product spec and
`maxfly_stack_and_setup.md` for the ops/tooling plan.

## Architecture

```
frontend (React + Vite + TS)  ──/api──▶  backend (FastAPI)
   video preview + waveform                 │  enqueue
   transcript panel + editor                ▼
                                     Celery task (eager in dev, Redis in prod)
                                       │ ffmpeg extract → Sarvam → segments
                                       ▼
                                     Postgres/SQLite  +  media storage (local/R2)
```

**Non-destructive core:** `transcripts` + `segments` are immutable after ingest;
`caption_cues` are derived and regenerated; `edits` is the layered decision list
(silence cuts, retakes, caption edits) applied only at export.

## Quick start (dev)

### Backend
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env         # then put your SARVAM_API_KEY in .env
uvicorn app.main:app --reload --port 8000
```
Runs on SQLite with tasks executed inline — no Postgres/Redis needed to start.
Health check: http://localhost:8000/api/health · API docs: http://localhost:8000/docs

### Frontend
```bash
cd frontend
npm install
npm run dev      # http://localhost:5173  (proxies /api to :8000)
```

### Production services (optional)
```bash
docker compose up -d    # Postgres + Redis
# then set DATABASE_URL and REDIS_URL in backend/.env
```

## Sarvam quality gate (PRD Day-1)
```bash
cd backend && source .venv/bin/activate
python scripts/sarvam_quality_test.py path/to/tamil_clip.wav ta-IN
```
Prints transcribe / translit / codemix output so you can judge Thanglish quality
before committing to a style layer.

## Status vs roadmap
- **M0 foundation** ✔ upload, ffmpeg extract, Sarvam transcribe, non-destructive persistence
- **M1 caption core** ✔ cues (7 langs + romanized), SRT/VTT/ASS, burned-in MP4 (ffmpeg), all export formats honor the edit layer
- **M2 editor** ✔ (v1) timeline waveform, synced preview, click-to-seek, inline caption edit
- **Auth / login** ✔ Supabase Auth (email/password + Google), JWT verified server-side via JWKS (HS256 fallback), per-user project ownership enforced; gated by AUTH_ENABLED / VITE_AUTH_ENABLED (off in dev). Verified: no-token 401, cross-user 404.
- **Multi-track / stem export** ✔ zip bundle with separate video (no audio) / voice / music (instrumental via stereo center-cancel, Demucs upgrade path) / captions (SRT+ASS) + a multi-track FCPXML (dialogue+music roles) for Premiere/DaVinci/FCP — honors cuts + enhancement (parity with HyproAI editable layers)
- **Audio enhancement** ✔ one-click "studio" voice cleanup on export — ffmpeg chain (highpass + afftdn denoise + compressor + EBU-R128 loudnorm), optional arnndn AI model via ARNNDN_MODEL_PATH; editor toggle, applied to burned MP4 (parity with HyproAI mic→studio)
- **Animated caption styles** ✔ 12 presets (classic, boxed, fade, slide-up, pop, bounce, neon glow, bold-yellow, uppercase, drop-shadow, word-by-word karaoke, highlight-words) — live CSS preview in editor + identical burn-in via ASS override tags (\fad/\move/\t/\kf); style chosen at export (parity with HyproAI 12 styles)
- **Filler-word remover** ✔ detects uh/um/hmm/er/aa (English + Indic disfluencies) as cut spans; conservative + aggressive modes; editor panel; honored at export via ripple-delete (parity with HyproAI)
- **M3 silence remover** ✔ auto-calibrated detection, review UI (cut map + toggles), and export honors cuts (ripple-delete: subtitles remapped, MP4 physically trimmed)
- **M5 timeline export** ✔ FCPXML (Premiere/DaVinci) + CMX3600 EDL from the cut timeline (dead air removed), caption markers in FCPXML — hand-written, no OpenTimelineIO dep
- **M4 retake remover** ✔ (manual-assisted) lexical near-duplicate detection (difflib + token overlap, no heavy embeddings), keeps the last take, review UI, applied via the same cut pipeline
- **Async processing** ✔ transcription AND exports (MP4 burn / stem bundle) run off the request thread via an in-process pool (`app/runner.py`) — requests return instantly, client polls status; export rows go processing→ready/error. No Redis needed for dev; `RUN_MODE=celery`+`REDIS_URL` for Celery workers at scale.
- **M6 billing / metering** ✔ per-minute usage metering + monthly plan caps (Free/Starter/Creator/Pro), quota enforced on transcription (402 over cap); billing UI (usage bar + plans + upgrade); payments behind a provider interface — MockProvider works with NO key (instant upgrade for testing), RazorpayProvider (orders + webhook) plugs in when RAZORPAY_KEY_* set
- **Later:** tighter within-cue alignment; real Supabase/Postgres + R2 (currently dev SQLite + local storage)

## Caption timing (important design decision)
Confirmed on real Tamil clips: Sarvam returns an accurate transcript but only **one
timestamp for the whole request** (REST and Batch, even with `with_timestamps`).
It does not give usable sub-clip timing.

So maxfly derives cue timing itself:
1. `ffmpeg silencedetect` finds the real pause boundaries. The threshold is
   **auto-calibrated** from each clip's mean volume (`mean + 2 dB`), because
   normalized creator audio barely dips — a fixed threshold finds nothing.
2. The transcript's words are distributed across those pause-anchored speech
   segments in proportion to duration.

Result: cues start/end on natural pauses and vary in length (verified: 11 well-timed
cues from a 25s clip that Sarvam returned as a single block). See
`app/services/segmentation.py`. Word placement within a segment is proportional
(approximate) and editable in the UI.

## Sarvam mode note
On real Tamil, **codemix** (Tamil script + English loanwords in Latin, ₹/$ symbols)
came back full-length and highly readable — a strong default for the "Thanglish"
display. Pure **translit** read well but truncated on the test clip; treat as
best-effort pending more testing.
