# Deploying maxfly.ai

Two pieces: **frontend** (static React) → Vercel, **backend** (FastAPI + ffmpeg + workers)
→ a container host (Railway or Render). Database + storage are already on Supabase.

## 0. Push to GitHub
```
cd C:\Users\91709\Desktop\maxfly.ai
git add -A && git commit -m "Deploy: maxfly"
gh repo create maxfly --private --source=. --push     # or create a repo on github.com and push
```

## 1. Backend → Render (or Railway)
**Render:** New → Blueprint → pick this repo (uses `render.yaml`). Or New → Web Service →
Docker → root `backend/`. Then set env vars (marked `sync:false`):
- `SARVAM_API_KEY`, `DATABASE_URL` (Supabase **session pooler** URL, `postgresql+psycopg://postgres.<ref>:<pw>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`),
  `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ORIGINS` (your Vercel URL).
- Leave `AUTH_ENABLED=false` for now.

**Railway:** New Project → Deploy from GitHub → it detects `backend/Dockerfile`. Add the same env vars.

Copy the resulting API URL (e.g. `https://maxfly-api.onrender.com`) and check `…/api/health`.

## 2. Frontend → Vercel
- Import the repo in Vercel; set **Root Directory = `frontend`** (it uses `frontend/vercel.json`).
- Env vars: `VITE_API_BASE = <your backend URL>`, plus `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
  (already in `.env.production`), `VITE_AUTH_ENABLED=false`.
- Deploy. Note the Vercel URL and put it in the backend's `CORS_ORIGINS`, then redeploy the backend.

## 3. Domain (later)
Point `maxfly.ai` at Vercel (frontend) and a subdomain like `api.maxfly.ai` at the backend host.

## 4. Turn on auth + payments (after it's live)
- Backend: `AUTH_ENABLED=true`; Frontend: `VITE_AUTH_ENABLED=true`.
- Supabase → Auth → URL Config: add the Vercel URL; enable Google provider.
- Add Razorpay keys (`RAZORPAY_*`) to the backend; point a webhook at `/api/billing/webhook`.
