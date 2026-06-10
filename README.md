# GovPrep

An AI-native study companion for Indian government / PSU exams — **live at
https://golden007-prog.github.io/Govt-Prep/**. Pick a target exam + date, get an adaptive
day-by-day plan from that exam's real syllabus and pattern, then study with the full toolkit
([all 30 features](./FEATURES.md)): AI notes / quizzes / grading / homework / mnemonics,
FSRS spaced-repetition flashcards, a streaming doubt-solver chat, a daily current-affairs
digest + quiz, and **CBT-style full-length mock tests** that mirror the real exam's rules —
plus XP/streaks/achievements, mastery tracking, heatmaps, pomodoro, backup, and PWA install.

First target exam: **Coal India Ltd — Management Trainee (Systems / CS)**. Adding an exam = adding
taxonomy data, not code.

> **Source of truth:** [`AGENTS.md`](./AGENTS.md). Read it before each milestone.

## Architecture (v3 — hybrid, Claude-only)

**Anthropic Claude is the only AI provider.** In the hosted app you bring your own API key
(Setup screen; stored in `localStorage`, sent browser-direct to Anthropic). No Gemini/Google
APIs anywhere; lectures are curated YouTube link-outs.

| Concern | Hosted (multi-user) | Local-first / desktop |
| --- | --- | --- |
| Frontend | Static SPA on **GitHub Pages** | same SPA (`npm run dev`) |
| Backend | **Supabase**: Postgres + Auth (GitHub OAuth) + RLS | Node/Fastify `/Backend` |
| AI brain | Browser BYOK → `api.anthropic.com` | same (backend `claude -p` optional later) |
| Data | IndexedDB (Dexie) + cloud sync of profile/plan; shared `content_cache` | IndexedDB (Dexie), on-device |

The app depends only on interfaces (`Brain`, `VideoIngestor`, `Store`), so implementations swap
with zero changes elsewhere. **The expensive AI work is cached per (exam-family, topic, language)
and shared across users via Supabase `content_cache` — never regenerated per user.**

## Run it (local dev)

```bash
npm run install:all        # root + Frontend + Backend
npm run dev                # Vite frontend + Fastify backend (concurrently)
```

- Frontend: http://localhost:5173  ·  Backend health: http://localhost:8787/health
- With no Supabase env set, the app runs **local-first** (Dexie). Onboarding → plan → dashboard all
  work offline. Configure `Frontend/.env.local` (see `Frontend/.env.example`) to enable the hosted path.

## Supabase (hosted backend) — driven via the Supabase MCP

All Supabase ops go through the **Supabase MCP server**. To connect it:

1. Create a Supabase **Personal Access Token**: https://supabase.com/dashboard/account/tokens
2. Register the server (user scope keeps the token out of this repo):
   ```bash
   claude mcp add -s user supabase --env SUPABASE_ACCESS_TOKEN=<token> -- npx -y @supabase/mcp-server-supabase@latest
   ```
3. **Reload Claude Code** (new MCP servers load at startup).
4. Then: create project (Mumbai) → apply `supabase/migrations/0001_init.sql` → run `supabase/seed.sql`
   → enable GitHub OAuth → copy URL + anon key into `Frontend/.env.local`. See `supabase/README.md`.

## Layout
```
Frontend/   Vite + React + TS + Tailwind SPA  (src/lib = Claude Code; src/ui = Antigravity)
  src/lib/{types,config,taxonomy,plan,store,brain,video,ca,auth,api}
  src/data/exams/*.json    # config-driven exam taxonomies (CIL verified, SSC stub)
Backend/    Node + Fastify local backend (health, claude, transcript)
supabase/   migrations + seed + config (hosted schema, applied via MCP)
```

## Milestone status
- **M0 — Scaffold** ✅ hybrid foundation: config-driven taxonomy loader, store abstraction
  (Dexie + Supabase), interfaces, mode detection, `/health`, Supabase schema.
- **M1 — Taxonomy engine + onboarding** ✅ pick exam/date/language → deterministic adaptive plan →
  dashboard. Verified CIL pattern.
- M2 topic study loop · M3 FSRS · M4 daily current affairs · M5 CBT mock simulator · M6 reward/adaptivity
  · M7 tiers/BYOK · M8 deploy. (See `AGENTS.md`.)

No secrets in code or logs. Strict TypeScript.
