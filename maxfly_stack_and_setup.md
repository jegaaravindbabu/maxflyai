# maxfly.ai — Tools & Documents for real operation

Everything you need to build **maxfly.ai** and run it as a live product. Organized by
category, with a specific recommended pick, why it's there, when you need it
(**Now** = before/at build, **Soon** = before public launch, **Later** = when scaling/monetizing),
and rough cost. India-appropriate choices flagged.

---

## 1. Build & dev tools (Now)

| Tool | Pick | Why | Cost |
|------|------|-----|------|
| AI build agent | **Claude Cowork / Claude Code** | Writes and iterates the app from the PRD + milestone briefs | Your Claude plan |
| Version control | **GitHub** | Source of truth, CI, deploy hooks | Free |
| Editor | **VS Code** | Local edits, debugging | Free |
| Runtimes | **Python 3.11+**, **Node.js 20+** | Backend (FastAPI) + frontend (Vite) | Free |
| Local services | **Docker + docker-compose** | Run Postgres + Redis locally while building | Free |
| Media engine | **ffmpeg** | Audio extract, silence detect, caption burn-in, all media ops | Free (open source) |

---

## 2. AI / processing engine (Now)

| Tool | Pick | Why | Cost |
|------|------|-----|------|
| Speech-to-text | **Sarvam AI — Saaras v3 (Batch API)** | Core engine: Tamil/Indic transcription, word timestamps, `translit`/`codemix`, diarization | ~₹30/hr (₹45 w/ diarization) |
| Credits | **Sarvam Startup Program** | 6–12 months of API credits — apply Day 1 | Free credits |
| Sarvam dev skill | `npx skills add sarvamai/skills --skill speech-to-text` | Generates correct STT code in Cowork | Free |
| Embeddings (M4 retake remover) | **sentence-transformers** (self-host) or an embeddings API | Detect near-duplicate takes | Free self-host / low API cost |
| LLM (optional, Thanglish style layer) | **Anthropic or OpenAI API** | Only if Day-1 test shows Sarvam's Thanglish needs cleanup | Pay-per-use |

---

## 3. Backend infrastructure (Now → Soon)

| Tool | Pick | Why | Cost |
|------|------|-----|------|
| DB + auth + storage | **Supabase** (already connected) | Postgres + user auth + file storage in one | Free tier → ~$25/mo |
| Job queue broker | **Upstash Redis** (serverless) or self-hosted Redis | Celery needs a broker for async video jobs | Free tier → low |
| Backend + worker hosting | **Railway** or **Render** (simplest) or **Hetzner VPS** (cheapest, more setup) | Runs FastAPI + Celery workers; workers need CPU for ffmpeg | ~$5–20/mo to start |
| Video/object storage | **Cloudflare R2** | Stores source video + renders; **no egress fees** (critical for video bandwidth) | Cheap; no egress |
| CDN | **Cloudflare** | Serve media fast, cache, protect origin | Free tier |

> Rule: never run transcription or ffmpeg renders inside an HTTP request — always on the
> Celery workers. Size workers by CPU (ffmpeg), not by ASR (that's Sarvam's servers).

---

## 4. Frontend hosting (Soon)

| Tool | Pick | Why | Cost |
|------|------|-----|------|
| Frontend host | **Vercel** (already connected) | Deploy the React/Vite editor, preview URLs | Free tier → $20/mo |
| Domain | **maxfly.ai** | Your brand (purchase later — quote via Vercel when ready) | ~$160 / 2 yrs |

---

## 5. Payments & billing (Later — before you charge)

| Tool | Pick | Why | Cost |
|------|------|-----|------|
| Payments | **Razorpay** (India-first) | UPI + cards + subscriptions, built for Indian businesses & GST | ~2% per txn |
| (If going global) | **Stripe** | Better for international cards/subscriptions | ~2.9% + fee |
| Billing logic | Razorpay Subscriptions or a light in-app metering | Enforce per-minute plan limits (video AI cost scales with minutes) | — |

> Price each plan so one processed video more than covers its Sarvam + compute cost.
> Track processing minutes per user from day one, even before you charge.

---

## 6. Product operations tooling (Soon → Later)

| Tool | Pick | Why | Cost |
|------|------|-----|------|
| Transactional email | **Resend** or **AWS SES** | Signup, reset, "your video is ready" notifications | Free tier → low |
| Error monitoring | **Sentry** | Catch backend/frontend errors in production | Free tier |
| Product analytics | **PostHog** | Funnels, activation, retention (open source, generous free tier) | Free tier |
| Uptime monitoring | **BetterStack** or **UptimeRobot** | Know when the app or workers go down | Free tier |
| Support | Email first → **Crisp** later | Talk to your first creators | Free → low |

---

## 7. Business & legal (Soon — real operation)

| Item | Why |
|------|-----|
| **Operating entity** | Run under a registered company (you already operate Indian Pixels — reuse or create). Razorpay + GST need a business identity. |
| **GST registration** | Required to invoice Indian customers; Razorpay onboarding expects it. |
| **Terms of Service** | You host user-uploaded video — you need clear usage terms. |
| **Privacy Policy** | You process personal + creator content; state what you collect, store, and delete. |
| **Data retention & deletion policy** | Creators' raw footage is sensitive; commit to retention limits + delete-on-request. |
| **Trademark check** | Quick search that "maxfly" isn't taken in your class before you invest in the brand. |

> Not legal advice — use a standard SaaS ToS/Privacy template and, if this becomes real
> revenue, have a lawyer glance at it. Content-hosting products get this wrong at their peril.

---

## 8. Documents to have (specs & runbooks)

| Document | Status | Purpose |
|----------|--------|---------|
| **PRD.md** | ✅ done | Product, features, architecture, data model, Sarvam specs |
| **BUILD_PLAN_COWORK.md** | ✅ done | 2-week plan + paste-ready milestone briefs |
| **sarvam_quality_test.py** | ✅ done | Day-1 Thanglish quality gate |
| **Eval harness** (`/eval`) | to build (Phase-1 idea) | Ground-truth clips + WER/CER metrics; re-run when caption logic changes |
| **`.env.example`** | to write | Every secret/config key the app needs (see §9) |
| **API spec (OpenAPI)** | auto | FastAPI generates this at `/docs` — keep it as your contract |
| **Architecture diagram** | ✅ (in chat) | The pipeline/system diagram — drop into the repo README |
| **Deployment runbook** | to write | How to deploy backend, workers, frontend; how to roll back |
| **Pricing & plans doc** | Later | Tiers, per-minute limits, free-tier caps |
| **ToS + Privacy Policy** | Soon | Legal (see §7) |

---

## 9. Secrets checklist (`.env.example`)

```
# Sarvam
SARVAM_API_KEY=

# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=

# Redis / Celery
REDIS_URL=

# Cloudflare R2 (S3-compatible)
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=

# Email (Resend or SES)
RESEND_API_KEY=

# Monitoring
SENTRY_DSN=
POSTHOG_KEY=

# Payments (later)
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=

# Optional LLM (Thanglish style layer)
ANTHROPIC_API_KEY=
```

---

## 10. Sign up for these TODAY (unblocks everything)

1. **Sarvam** — dashboard key + **Startup Program** application (time-sensitive; credits can
   cover your whole build). https://dashboard.sarvam.ai
2. **GitHub** repo for maxfly.ai.
3. **Supabase** project (you have it connected — create the maxfly project).
4. **Cloudflare** account (for R2 + CDN).

Everything else can wait until the milestone that needs it. Start the build with the M0
brief in BUILD_PLAN_COWORK.md once the Sarvam key works and the Day-1 quality test has run.
