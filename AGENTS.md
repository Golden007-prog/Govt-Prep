# GovPrep — Agent Spec (source of truth)

GovPrep is a **hybrid AI study companion** for Indian government/PSU exam prep — a hosted
multi-user platform **and** a local-first/BYOK option, sharing one codebase.
First fully-implemented exam: **Coal India Ltd Management Trainee — Systems (CS)**; the engine is
config-driven (adding an exam = adding taxonomy data, not code).

Both **Claude Code** and **Antigravity (Gemini)** read this file. Keep it the single
source of truth and update it whenever the architecture changes. Re-read before each milestone.

---

## Platform architecture (v3 — hybrid, Claude-only). Where this conflicts with sections below, this wins.

Decisions (locked 2026-06-09; v3 revision 2026-06-10):
- **AI provider (v3): Claude-only.** Every AI feature (notes, quizzes, grading, homework, flashcards,
  current affairs, doubt chat) runs on the **Anthropic API**. All Gemini/Google integrations are
  REMOVED. Hosted video ingestion is dropped: lectures **link out** to YouTube and study content is
  generated from the syllabus taxonomy; local mode may still ingest transcripts via the backend and
  summarize them with Claude.
- **Scope:** hybrid — hosted multi-user **+** local-first/BYOK.
- **Backend stack:** **Node + Fastify/TS** for the local backend; **Supabase** is the *hosted* backend
  (the spec's "FastAPI on Cloud Run" maps to Supabase — there is no Python and no Cloud Run).
- **Hosting:** static SPA on **GitHub Pages** at https://golden007-prog.github.io/Govt-Prep/
  (repo `Golden007-prog/Govt-Prep` → `base: '/Govt-Prep/'`). No server runs on Pages, so the
  hosted backend is Supabase. Deploys via `.github/workflows/deploy.yml` on push to `main`.
- **Supabase = hosted backend:** Postgres (the §6 data model + shared `content_cache`), **Auth = GitHub
  OAuth**, **Edge Functions** (server-side LLM with *operator* keys — built M2+), **pg_cron** (daily CA
  pipeline — M4). All Supabase ops are driven through the **Supabase MCP server**.
- **Local mode:** Node/Fastify `/Backend` (claude CLI + transcripts) + Dexie (on-device).
- **Two store impls** behind a `Store` interface: `DexieStore` (local/free/offline) and `SupabaseStore`
  (hosted, authenticated, RLS-isolated).
- **Model ids** are env-driven (`Frontend/src/lib/config`), never hardcoded; current ids in
  `.env.example`, confirm before deploy.
- **DB:** Postgres (Supabase). Region **ap-south-1 / Mumbai**.

Ownership: Claude Code → `Frontend/src/lib/**`, `Backend/**`, `supabase/**`. Antigravity → `Frontend/src/ui/**`.

Data model & taxonomy: `supabase/migrations/0001_init.sql` (hosted) mirrors `Frontend/src/data/exams/*.json`
(bundled, config-driven). Pattern correctness is *sacred*: marks / negative marking / counts / timing /
languages must match the real exam exactly (from the taxonomy).

Platform milestones (supersede the personal milestone list below):
M0 scaffold ✅ · M1 taxonomy + onboarding/plan ✅ · M2 topic study loop + `content_cache` ·
M3 FSRS · M4 daily current affairs (scheduled) · M5 ★ CBT mock simulator · M6 reward/adaptivity ·
M7 tiers + BYOK free tier · M8 deploy (Pages + Supabase). Commit per milestone.

---

## What it does (core loop)
1. Take the next topic from the adaptive study plan.
2. Recommend lectures as **YouTube link-outs** (channel whitelist in `/src/data/channels.json`:
   Gate Smashers, Neso Academy, Knowledge Gate, Jenny's Lectures, Feel Free to Learn, …).
3. Generate study notes from the syllabus taxonomy with Claude (local mode may additionally
   ingest the lecture transcript via the backend and ground the notes in it).
4. Generate a short summary + 10 questions (MCQ + short answer).
5. Grade the user's answers (free text graded by the LLM); explain mistakes.
6. Generate 1 homework set + 5 flashcards.
7. Schedule flashcards with FSRS; every wrong answer also becomes a card.
8. Update reward state (XP, streak, per-subject mastery); pick the next weakest / most-overdue topic.

---

## Two runtime modes (the central design)
Detect at startup: ping `http://localhost:8787/health`. Reachable → **local**; else → **hosted**.

### Hosted (github.io, no backend)
- **Brain:** Anthropic API key (BYOK), called from the browser with header
  `anthropic-dangerous-direct-browser-access: true`. (Subscription / local CLI is impossible in a browser.)
- **Video:** link-out only — lectures open on YouTube; study content generates from the syllabus
  taxonomy with Claude. No client-side video/transcript processing of any kind.
- **Transcripts:** NOT available (YouTube transcript endpoints are CORS-blocked). Never attempt client-side transcript fetch.
- **Keys:** one user-supplied Anthropic key, stored in `localStorage`, on a low spend cap.
- **Storage:** IndexedDB (Dexie) + JSON export/import.

### Local / desktop (downloaded)
- **Brain:** Claude — the local backend runs `claude -p --output-format json` (subscription) or
  calls the Anthropic API with `ANTHROPIC_API_KEY` from `Backend/.env`. Same Brain interface.
- **Video:** transcripts fetched by the backend (no CORS) — cheap/free — then summarized by Claude.
- **Storage:** local SQLite (or Dexie).
- **Packaging:** `npm run dev` (needs Node + Claude Code installed) or a Tauri desktop build.

---

## Hard constraints (do NOT violate)
- **Never hardcode API keys or tokens** anywhere. Read from settings (localStorage) or backend env.
- **Never fetch YouTube transcripts from the browser** (CORS). Hosted = Gemini-by-URL; local = backend.
- Hosted brain MUST send `anthropic-dangerous-direct-browser-access: true`.
- A browser build can **never** use the Claude subscription or the local `claude` CLI.
- **No Gemini/Google APIs anywhere** (v3). The only AI provider is Anthropic.
- **Cache every generated artifact** (notes/quiz/cards/homework/CA) — never regenerate what exists.
- Keep LLM calls **lean and batched** (one call returns summary + quiz + homework + cards where possible).
  Note: from **2026-06-15**, programmatic `claude -p` on a subscription draws from a separate monthly
  Agent SDK credit, then API rates — so don't make chatty calls.
- All app data stays **on-device**. No server stores user data.

---

## Architecture: one Brain interface (Claude-only)
`Brain` (see `Frontend/src/lib/brain/types.ts`): `makeStudyBundle(source, ctx)` (one batched call →
notes + quiz + cards), `grade(question, answer, ctx)`, `makeHomework(notes, ctx)`.
- `AnthropicBrain` (`lib/brain/anthropicBrain.ts`): `fetch` → `api.anthropic.com` with the
  direct-browser-access header + the user's key. Used in BOTH modes today.
- `LocalClaudeBrain` (optional, later): `POST` → `localhost:8787/claude` → backend spawns `claude -p`.

The rest of the app depends **only** on the `Brain` interface, so swapping the impl changes nothing
elsewhere. Video: `VideoIngestor` → `TranscriptIngestor` (local mode only); hosted links out.

---

## Tech stack
- **Front-end:** Vite + React + TypeScript + Tailwind. Routing: **HashRouter**; `base: '/Govt-Prep/'` in `vite.config.ts` (matches the repo name — Pages serves at /<repo>/).
- **State/store:** Dexie (IndexedDB). **FSRS:** `ts-fsrs`.
- **Providers:** Anthropic only, via `fetch` (BYOK). YouTube is link-out only (no Data API key).
- **Local backend (`/server`):** Node + Fastify. Routes: `GET /health`, `POST /claude` (spawn `claude -p`), `GET /transcript?v=` (transcript lib). No secrets in the client.
- **Packaging:** GitHub Actions → Pages (hosted); Tauri (desktop).

---

## Folder structure
```
/src
  /ui            # screens + components            (Antigravity / Gemini owns)
  /lib
    /api         # youtubeClient, modeDetect       (Claude Code owns)
    /brain       # Brain interface + 2 impls
    /video       # VideoIngestor + 2 impls
    /srs         # ts-fsrs wrapper
    /store       # Dexie schema + repos
  /data          # plan.json (21-day plan), channels.json
/server          # local backend                   (Claude Code owns)
vite.config.ts
AGENTS.md  CLAUDE.md  GEMINI.md
```

---

## Build order (milestones — build in sequence, commit each)
- **M0** Scaffold: Vite + React + TS + Tailwind, HashRouter, base path, Dexie init.
- **M1** Mode detection + two Setup screens (Claude setup → Google key) + settings persistence.
- **M2** YouTube search (whitelist ranking) + video picker.
- **M3** Video ingest: `TranscriptIngestor` (local mode) behind `VideoIngestor`; hosted = link-out.
- **M4** Quiz + grading via `Brain`.
- **M5** Homework via `Brain`.
- **M6** Flashcards + `ts-fsrs` scheduling; wrong answer → card.
- **M7** Reward engine: XP, streak, mastery, next-topic picker + dashboard.
- **M8** Mock mode: timed 100-Q Paper I/II simulator, no negative marking, analytics.
- **M9** Deploy: Pages workflow; Tauri desktop build; README.

---

## Division of labor (two build agents, one repo)
- **Claude Code** → `/server` and `/src/lib/**` (brain, video, store, api, mode logic). Owns dual-mode correctness.
- **Antigravity (Gemini)** → `/src/ui/**` (screens, components, styling, browser-preview iteration).
- Don't let both edit the same files at once. Use **git**; commit per milestone. Both obey this file.
- Reminder: Gemini is only a *build tool* (Antigravity); **Claude is the only runtime model** (v3).
  Keep them straight.
