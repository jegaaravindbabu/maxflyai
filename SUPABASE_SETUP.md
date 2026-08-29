# maxfly.ai — Supabase setup

A Supabase project **maxfly** (region ap-south-1 / Mumbai) is already provisioned
and the schema + a private `media` storage bucket are created.

- Project ref: `eimouchjvvnvcnrrzwmm`
- API URL: `https://eimouchjvvnvcnrrzwmm.supabase.co`
- Dashboard: https://supabase.com/dashboard/project/eimouchjvvnvcnrrzwmm

## To run the backend against Supabase

1. `cp backend/.env.production backend/.env`
2. Fill the **two secrets** (both from the dashboard):
   - **DB password** → in `DATABASE_URL`. Get the ready-made string from
     *Project Settings → Database → Connection string → Session pooler*, or set/reset
     the password there and paste it into the URL.
   - **SUPABASE_SERVICE_ROLE_KEY** → *Project Settings → API → `service_role` (secret)*.
     Needed for server-side media upload/download to the private bucket.
3. `pip install -r requirements.txt -r requirements-postgres.txt`  (adds the Postgres driver)
4. `uvicorn app.main:app --reload --port 8000`

The app auto-creates any missing tables on startup (idempotent), and the schema is
also in `backend/migrations/001_init.sql` for reference.

## Auth (optional)
Login is **off** by default so you can develop without it. To turn it on:

1. Backend `backend/.env`: set `AUTH_ENABLED=true`. Leave `SUPABASE_JWT_SECRET`
   blank — this project's tokens are verified via the project JWKS automatically.
   (Only set the secret for legacy HS256 projects.)
2. Frontend `frontend/.env`: set `VITE_AUTH_ENABLED=true` (URL + anon key are
   already filled in).
3. In the Supabase dashboard → **Authentication**:
   - **URL Configuration** → add `http://localhost:5173` to Site URL + Redirect URLs
     (and your production URL later) so email-confirmation and Google redirects work.
   - **Providers → Google** → enable it and paste Google OAuth client id/secret if you
     want the "Continue with Google" button (email/password works without this).

With auth on, every API call carries the user's token, and each person only sees
their own projects (enforced server-side). Run `npm install` in `frontend/` once to
pull the `@supabase/supabase-js` dependency.


## Storage
`STORAGE_BACKEND=supabase` stores uploads/renders in the private `media` bucket and
serves them via short-lived signed URLs. Switch to `local` for pure local dev, or
`r2` (fill the `R2_*` vars + `pip install boto3`) for Cloudflare R2 (no egress fees).

## What stays in dev mode
`backend/.env` (the default) uses SQLite + local storage and needs no secrets — good
for offline work. `.env.production` is the Supabase switch.
