# Scaling maxfly.ai

How the backend scales from a single box to a queue + autoscaling workers, and
what it costs. Target: ~2,000 monthly-active users (10k signups), light usage.

## Architecture

```
                       ┌──────────────┐
   browser ──HTTP──▶   │  maxfly-api  │  FastAPI, HTTP only (never ffmpeg)
                       └──────┬───────┘
                              │ enqueue job (Celery)
                       ┌──────▼───────┐
                       │ maxfly-redis │  broker + result backend
                       └──────┬───────┘
                              │ pull job
                       ┌──────▼───────┐
                       │ maxfly-worker│  transcription + ffmpeg exports
                       │  (autoscale) │  1 → 3 instances on CPU
                       └──────────────┘

   Postgres  → Supabase (DB + Auth)
   Media     → Cloudflare R2 (S3 API, zero egress)  ·  Supabase Storage (fallback)
   Frontend  → Vercel (static React + CDN)
```

The API never runs ffmpeg — it only enqueues. Workers do the heavy lifting and
scale out under load, so a burst of exports never slows the API or OOMs it.

## How dispatch works (code)

- `RUN_MODE=celery` + a `REDIS_URL` → `runner.use_celery()` is true and jobs go to
  Celery (`transcribe_task.delay(...)`, `export_task.delay(...)`).
- No `REDIS_URL` → Celery runs eager/in-process (`runner.submit`), same as before.
  **So deploying the code changes nothing until Redis + a worker exist** — a safe rollout.

Key files: `app/celery_app.py`, `app/runner.py`, `app/tasks/*.py`,
`app/routers/{transcripts,exports}.py`, `app/services/storage.py` (Local/Supabase/R2).

## Deploy (Render)

1. **Workspace → Pro** ($25/mo) — required for autoscaling + background workers.
2. **Create Key Value (Redis)** `maxfly-redis` — Starter (no-eviction). Free 25 MB works to start.
3. **Create Background Worker** `maxfly-worker` from this repo, start command:
   `celery -A app.celery_app worker --loglevel=info --concurrency=2 --max-tasks-per-child=20`
   Plan: Standard (2 GB). Scaling: min 1 / max 3 / target CPU 70%.
4. **API** `maxfly-api` → upgrade Starter → **Standard**. Scaling: min 1 / max 2.
5. On **both** api and worker set: `REDIS_URL` (from the Redis instance) and `RUN_MODE=celery`.
   Everything else lives in the `maxfly-shared` env group.

> If the service is Blueprint-linked, syncing `render.yaml` does steps 2–5 for you —
> just fill the env-group secrets in the dashboard.

## Deploy (data + media + frontend)

- **Supabase → Pro** ($25/mo): stops idle-pausing, lifts DB/connection limits.
- **Cloudflare R2**: create a bucket + API token, set `R2_ACCOUNT_ID`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, then set
  `STORAGE_BACKEND=r2`. New uploads go to R2; files already in Supabase stay there.
- **Vercel → Pro** ($20/mo) for commercial use. Frontend env: `VITE_API_BASE`,
  `VITE_AUTH_ENABLED`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## Environment variables

| Key | Where | Notes |
|-----|-------|-------|
| `RUN_MODE` | api, worker | `celery` in prod |
| `REDIS_URL` | api, worker | from the Redis instance |
| `DATABASE_URL` | api, worker | Supabase session-pooler (`postgresql+psycopg://…`) |
| `SARVAM_API_KEY` | api, worker | transcription |
| `STORAGE_BACKEND` | api, worker | `supabase` → `r2` |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | api, worker | R2 |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_BUCKET` | api, worker | storage + admin |
| `AUTH_ENABLED` / `ADMIN_EMAILS` / `SUPABASE_JWT_SECRET` | api, worker | auth |
| `CORS_ORIGINS` | api | Vercel URL |
| `RAZORPAY_*` | api | payments |

Secrets never carry a `VITE_` prefix and never go in the frontend.

## Run the full pipeline locally

```
docker compose up --build        # postgres + redis + api + worker
# API on http://localhost:8000 ; point the frontend VITE_API_BASE at it
```
Uses `backend/.env` for secrets; compose overrides `DATABASE_URL` / `REDIS_URL` /
`RUN_MODE` to the local services. To run the app outside Docker, start just the
infra (`docker compose up postgres redis`) and point the URLs at localhost.

## Verify it's actually using workers

- `GET /api/health` returns commit + RSS.
- Trigger an export → the **worker** logs show `maxfly.export` received; the API
  stays responsive. Redis `LLEN celery` shows the queue draining.

## Cost (≈ 2,000 monthly-active, light usage)

| Service | Plan | $/mo |
|---|---|---:|
| Render workspace | Pro | 25 |
| Render API | Standard | 25 |
| Render worker | Standard (1–2 avg) | 25–50 |
| Render Redis | Starter | 10 |
| Supabase | Pro | 25 |
| Vercel | Pro | 20 |
| Cloudflare R2 | usage | ~10 |
| Sarvam STT | ~20,000 min @ ₹0.50 | ~118 |
| Monitoring / misc | — | ~10 |
| **Total** | | **≈ $270–390/mo (₹23,000–33,000)** |

~$150 is fixed platform; the rest scales with usage. Break-even is ~2–3% paid
conversion. Prices verified Sep 2026 — treat as planning ranges, not quotes.

## Cost controls (already in code)

- Per-plan minute quotas enforced in billing.
- Cap max length / resolution per tier; auto-delete free-tier files after 7 days.
- `--max-tasks-per-child=20` recycles workers to bound memory.
