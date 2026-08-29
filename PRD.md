# PRD — maxfly.ai (AI Video Caption & Editor)

**Owner:** Solo founder
**Status:** Draft v1 — for build in Claude Cowork
**Category:** Browser-based AI video editor for creators, Indian-language-first
**Reference competitor:** HyproAI (do not clone pixel-for-pixel — compete in the same category with a Tamil/Thanglish quality edge)

---

## 1. Overview & vision

A browser-based video editor that auto-generates accurate captions and regional-language
subtitles (Tamil, Telugu, Hindi, Malayalam, Kannada, Bengali, English) plus romanized
"Thanglish/Hinglish"-style output, removes silences and repeated takes, and exports both
finished captioned video and editable timelines for Premiere / DaVinci Resolve.

The AI heavy-lifting (transcription, word timing, code-mix, romanization, diarization) is
done by **Sarvam AI's Saaras** speech models via API. The product's own value is the
**editor UX, the edit intelligence (silence/retake), the export pipeline, and Thanglish
quality tuned for real creators.**

**Positioning bet:** be the best tool for *Tamil-first creators* — better Thanglish, a
workflow tuned to their format — before going wide. Founder is in Chennai, close to both
the creators and the language.

---

## 2. Problem & target users

**Problem:** Regional-language creators spend hours manually captioning, cutting dead air,
and removing botched takes. Generic tools (Descript, CapCut, Submagic) handle English well
but are weak on Tamil, code-switching, and romanized captions that Indian audiences read.

**Primary user:** Solo/independent Tamil YouTube & Instagram creators recording talking-head
or voice-over content, who want fast, accurate captions and lightly edited video without
touching a full NLE.

**Secondary users later:** Telugu/Hindi/etc. creators; small agencies editing for creators.

---

## 3. Goals & non-goals

**Goals**
- Upload a video → get accurate captions with word-level timing in 7 languages + romanized.
- Edit captions and video non-destructively in the browser.
- Remove silences and repeated takes with review.
- Export SRT/VTT/ASS, burned-in MP4, and FCPXML/EDL timelines.
- Keep per-video processing cost well below price charged.

**Non-goals (v1)**
- Full multitrack NLE (multiple video layers, transitions, effects).
- Team collaboration / real-time multiplayer editing.
- Mobile-native apps (responsive web only).
- AI dubbing / voice cloning (possible later via Sarvam Bulbul/Dubbing).

---

## 4. Competitive context

HyproAI (Chennai, incorporated Dec 2025) offers silence removal, retake removal,
auto-captions and regional subtitles including romanized forms, browser-based, with
timeline export to Premiere/DaVinci/After Effects.

**Differentiation strategy (pick at least one, don't compete on feature parity alone):**
- **Quality:** demonstrably better Tamil + Thanglish caption accuracy.
- **Niche workflow:** presets/format tuned to one creator type (e.g. short-form talking head).
- **Price/format:** a free tier or output format the incumbent doesn't offer.

---

## 5. Scope & feature specs

Full feature set is the goal, delivered in milestones (see §11). Specs below are the target.

### 5.1 Captions & multi-language subtitles
- Auto-transcribe uploaded video via Sarvam Saaras.
- Word-level timestamps; group into caption cues using reading-speed rules
  (≈15–17 chars/sec, max ~42 chars/line, 1–7s per cue, max 2 lines).
- Languages: English, Tamil, Telugu, Hindi, Malayalam, Kannada, Bengali.
- Speaker diarization labels (Batch API) for multi-speaker clips.

### 5.2 Thanglish / romanized & code-mixed output
- Produce romanized (Latin-script) captions via Sarvam `translit` mode.
- Produce code-mixed output via `codemix` mode.
- **Quality gate (Day 1):** test `translit`/`codemix` on real Tamil clips. If creator-grade,
  ship as-is. If stiff/wrong, add a thin style-correction layer (rules + optional LLM pass).

### 5.3 Editor
- Timeline with audio waveform (wavesurfer.js).
- Video preview with live caption overlay, synced to playhead.
- Transcript panel: click a word to seek; edit caption text inline; edits update cues.
- Caption styling: font, size, color, position, highlight styles, presets.

### 5.4 Silence remover
- Detect silences (ffmpeg `silencedetect`, tunable threshold/min-duration).
- Produce a cut list applied **non-destructively** to timeline + transcript timing.
- Review UI: see cuts, toggle/adjust each, before applying.

### 5.5 Retake remover (hard / later)
- Segment transcript into utterances.
- Detect near-duplicate consecutive utterances via multilingual sentence embeddings.
- Score each candidate take (audio energy + ASR confidence); suggest keeping the cleanest.
- User confirms; always allow manual override. Ship a manual-assisted mode first.

### 5.6 Export
- Subtitles: SRT, VTT, ASS (styled).
- Burned-in captioned MP4 (ffmpeg + ASS).
- Editable timeline: FCPXML (imports to Premiere & DaVinci Resolve) and EDL, built on
  OpenTimelineIO. After Effects has no clean timeline import — route via FCPXML/Premiere,
  treat as lower priority.

---

## 6. Technical architecture

**Frontend:** React + TypeScript (Vite). wavesurfer.js for waveform/timeline. HTML5 video
element + caption overlay for preview.

**Backend:** Python + FastAPI. Celery + Redis for async jobs (video work is slow — never do
it in a request). Postgres for data.

**Storage/auth:** Supabase (Postgres + auth + storage) to cut plumbing. Video/media in
Supabase Storage or Cloudflare R2 (R2 has no egress fees — matters for video bandwidth).

**Media:** ffmpeg for all audio/video ops.

**ASR:** Sarvam Saaras via **Batch API** (long files); REST only for <30s clips.

**Core principle — NON-DESTRUCTIVE EDITING:**
The original transcript (words + timestamps) is the immutable source of truth. Silence cuts,
retake removals, and caption edits are stored as an **edit decision list** layered over the
original. Final video is rendered only at export. Build this from day one — retrofitting a
second edit type onto a destructive model means a rewrite.

```
[Browser: React editor]
        | upload / edit / export requests
        v
[FastAPI API] --enqueue--> [Redis] --> [Celery workers]
        |                                   |
        v                                   v
   [Postgres]                        [ffmpeg + Sarvam Batch API]
        ^                                   |
        |                                   v
   [Supabase/R2 storage] <---- media in / renders out
```

---

## 7. Data model (Postgres)

Non-destructive: `transcripts`/`words` are immutable after ingest; `edits` is the layer.

- **users** — from Supabase auth.
- **projects** — `id, user_id, name, source_media_url, duration_ms, status, created_at`.
  `status`: `uploaded | transcribing | ready | exporting | error`.
- **transcripts** — `id, project_id, language_code, mode, provider_job_id, raw_json, created_at`.
- **words** — `id, transcript_id, idx, text, translit_text, start_ms, end_ms, speaker, confidence`.
- **caption_cues** — `id, project_id, idx, start_ms, end_ms, text, translit_text, line_count`
  (derived from words; regenerated when words/edits change).
- **edits** — `id, project_id, type, payload_json, enabled, created_at`.
  `type`: `silence_cut | retake_remove | caption_edit | manual_cut`.
  `payload_json`: e.g. `{ "start_ms":..., "end_ms":... }` for a cut,
  `{ "word_idx":..., "new_text":... }` for a caption edit.
- **exports** — `id, project_id, format, url, status, created_at`.
  `format`: `srt | vtt | ass | mp4 | fcpxml | edl`.
- **jobs** — `id, project_id, kind, status, error, created_at` (mirror of Celery for UI).

---

## 8. Sarvam integration (verified specs — recheck before build)

- **Model:** `saaras:v3`. Endpoint `/speech-to-text`.
- **Modes (mode param, saaras:v3 only):**
  `transcribe` (same language), `translate` (to English), `verbatim` (with fillers —
  useful for retake detection), `translit` (romanized Latin script → Thanglish path),
  `codemix` (code-mixed output).
- **API types & LIMITS:**
  - REST (sync): audio **≤30s per request** — only for quick tests.
  - **Batch (async): files up to 2h, up to 20 files/job — USE THIS in production.**
    Diarization (up to 20 speakers) is Batch-only. Flow: submit job → poll status → fetch.
  - Realtime streaming exists but not needed for v1.
- **Audio formats:** mp3, wav, aac, flac, m4a/mp4, ogg/opus, webm, etc. Auto codec detect
  (PCM needs explicit codec, 16kHz).
- **Pricing:** ~₹30/hour transcribe, ₹45/hour with diarization, billed per second.
  A 10-min video ≈ ₹5 (~$0.06) to transcribe.
- **Dev tooling:** `pip install sarvamai` SDK; official agent skill
  `npx skills add sarvamai/skills --skill speech-to-text`; MCP server; `/llms.txt` docs index.
- **Credits:** apply to the **Sarvam Startup Program** (6–12 months API credits for
  early-stage) — could make ASR effectively free through build + launch.

**Action:** always confirm request/response shape against the official skill or
`https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/rest-api` — response field
names should be read from real output, not assumed (see the quality-test script).

---

## 9. Non-functional requirements

- **Async everything heavy.** No transcription/render inside an HTTP request.
- **Long-file handling.** For Batch API, respect the 2h/file limit; chunk longer content and
  stitch timestamps.
- **Cost guardrail.** Track processing minutes per user; price each plan so a processed
  video more than covers its Sarvam + compute cost.
- **Resilience.** Jobs retry on transient Sarvam/ffmpeg failure; surface clear errors to UI.
- **Privacy.** Creators' raw footage is sensitive — private storage, signed URLs, delete on
  request; state a retention policy.

---

## 10. Cost model (rough)

- Sarvam ASR: ~₹0.50/min of video (₹30/hr) — trivial; likely free under Startup Program.
- Compute: ffmpeg render on cheap CPU workers — cents per video.
- Storage/egress: main variable cost — use R2 (no egress) or lifecycle-delete source media.
- **Takeaway:** unlike typical SaaS, cost scales with video minutes — but at these rates the
  unit economics are comfortable as long as pricing is per-minute-aware.

---

## 11. Milestones / roadmap

| ID | Milestone | Ships? | Notes |
|----|-----------|--------|-------|
| M0 | Foundation: auth, upload, ffmpeg audio extract, Sarvam transcribe job, transcript persisted (non-destructive model) | internal | Everything hangs off this |
| M1 | Caption core: cues, 7 languages, translit/codemix, styling, SRT/VTT + burned-in MP4 export | **RELEASE** | First real value to creators |
| M2 | Editor: timeline, waveform, synced preview, click-to-seek, inline caption edit | yes | Biggest single lift |
| M3 | Silence remover: detect → non-destructive cut list → review UI | yes | Fast because of M0 |
| M4 | Retake remover: embedding-based duplicate detection + review | later | R&D; ship manual-assisted first |
| M5 | Timeline export: FCPXML/EDL via OpenTimelineIO | later | AE lower priority |
| M6 | Plans, billing, free tier, watermark policy, scaling | later | Monetize |

**2-week solo target with Cowork:** M0 + M1 + M2 + M3 (see BUILD_PLAN_COWORK.md).
M4/M5/M6 are week 3+.

---

## 12. Success metrics

- **Quality:** caption word error rate on a held-out Tamil test set; % of cues needing manual
  fix. (Reuse the Phase-1 eval harness.)
- **Activation:** % of uploads that reach a completed export.
- **Value:** time saved vs manual captioning (self-reported from first 10 creators).
- **Retention:** creators returning for a 2nd/3rd video.

---

## 13. Risks & open questions

- **Thanglish quality** is the core bet — resolved Day 1 by the quality test, not assumed.
- **Retake remover** may under-perform; keep manual fallback so product works regardless.
- **Long-file chunking** for Batch API is fiddly — budget buffer time.
- **Pure clone risk** — commit to one real differentiator (see §4).
- **Open:** exact Sarvam Batch response schema; AE export path; free-tier limits; brand name.
