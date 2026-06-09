# GovPrep — Platform Build Prompt (v2)

> Paste into **Claude Code** (owns backend + core logic) and/or Antigravity (owns UI). Self-contained: this is the **multi-user platform** scope (any user, any Indian govt exam) and **supersedes** the personal dual-mode spec. New since v1: hosted multi-user architecture, **daily current affairs**, and a **CBT-style MCQ mock simulator**.

---

You are an expert full-stack engineer building **GovPrep**, a multi-user, AI-native prep platform where **any user can prepare for any Indian government exam** (SSC, IBPS/SBI banking, RRB railways, UPSC, state PSCs, defence, and technical PSUs like CIL/ISRO/DRDO). The product is an **AI tutor layer over free content** (YouTube + public syllabi + previous-year papers), not a content/test-series store.

## 0. Before you write any code
1. Restate your plan for **M0 + M1** in 6–10 lines before coding.
2. Ask me **only** about genuine blockers (§10). Otherwise build milestone by milestone.
3. `git init`; commit after every milestone; never force-push.

## 1. Mission & success criteria
A hosted web app where a user picks a target exam and exam date, gets a personalized adaptive plan against that exam's real syllabus and pattern, studies topic-by-topic from curated free videos with AI notes/quizzes/spaced-repetition cards, gets a **daily exam-targeted current-affairs feed**, and practises on **full-length mock tests that mirror the real exam's interface and rules**. Success = the full loop works end-to-end for at least one exam; mocks accurately reproduce that exam's pattern (count, timing, negative marking, sectional cutoffs, bilingual); AI-generated content is grounded in PYQs; inference cost is amortized via caching; no hardcoded secrets.

## 2. The core principle that makes it economical
**The expensive AI work is per-(exam-family, topic, date) — never per user.** Generate a topic's notes/quiz/cards and a day's current-affairs digest **once**, cache in the DB, and serve to every user studying that exam. Use **transcript-based** server-side video ingestion (cheap), not per-second video models, and cheap models for routine generation. This is non-negotiable for unit economics.

## 3. Architecture (hosted, multi-user)
- **Frontend:** Vite + React + TypeScript (strict) + Tailwind. SPA.
- **Backend:** FastAPI on **Cloud Run (asia-south1)**. Async generation jobs via **Pub/Sub**; scheduled jobs via **Cloud Scheduler**.
- **DB:** Cloud SQL (Postgres) for relational data; object storage for assets.
- **Auth:** accounts (email/OAuth); per-user progress synced server-side.
- **LLM calls happen server-side only** (operator keys). Use Gemini (via Vertex AI) for transcript/CA summarization, Claude for grading + structured generation. **Keep all model IDs in one config module** — don't hardcode (§10).
- **Optional BYOK free tier:** a user may supply their own key to offset cost on a limited free plan; paid tier uses operator inference. (Build the paid/hosted path first.)
- **Content interfaces (dependency inversion):** `VideoIngestor` (transcript-based), `CurrentAffairsIngestor` (sources→summaries), and a `Brain` (`makeNotes`, `makeQuiz`, `grade`, `makeHomework`, `makeCards`). The app depends only on these interfaces.

## 4. Hard constraints (do not violate)
- **Cache, don't regenerate per user.** Key generated content by (exam-family / topic / date / version). Reuse across all users.
- **Ground in PYQs / primary sources.** Questions and CA items must be grounded and tagged; store source links; never present unverified facts as certain. Add a light correctness check.
- **Copyright/ToS:** summarize sources **in your own words and link out**. Never rehost third-party daily digests or YouTube transcripts. Embed/link videos; don't rehost them.
- **Per-exam pattern correctness is sacred:** question count, marks, **negative marking**, sectional timing/cutoffs, languages must exactly match the real exam (from the taxonomy config).
- **Bilingual** (English + Hindi minimum, extensible) across notes, quizzes, CA, and mocks.
- **Exams are config-driven:** adding an exam = adding taxonomy data, not code.
- **No hardcoded secrets;** server-side keys only; secure user data; minimal PII.
- Keep LLM calls **lean and batched** (one call returns notes + quiz + cards where possible).

## 5. Tech stack
React+TS+Tailwind (frontend) · FastAPI on Cloud Run (backend) · Cloud SQL/Postgres · Pub/Sub (async gen) · Cloud Scheduler (daily CA) · Vertex AI Gemini + Anthropic Claude (server-side) · `ts-fsrs` (spaced repetition, can run client or port server-side) · YouTube Data API (search).

## 6. Data model (core tables)
- `exams` (id, name, body, languages[], **pattern**: papers[], total_duration, **negative_marking**, sectional_cutoffs, qcount, has_sectional_timing)
- `subjects`, `topics` (per exam, with syllabus text + ordering)
- `content_cache` (key = exam_family+topic+type+version → notes/quiz/cards JSON, lang variants) — **shared across users**
- `questions` (id, exam_tags[], subject, topic, difficulty, stem, options, answer, explanation, **source**: PYQ|AI, lang variants)
- `current_affairs` (id, date, summary, source_url, subject, region, exam_relevance[], lang variants)
- `ca_sets` (date, exam_family → question_ids[])
- `users` (auth, target_exam, exam_date, language_pref, plan_state, tier)
- `user_progress` (topic mastery, streak, xp), `fsrs_cards` (per user)
- `mock_templates` (exam → sections[], per-section qcount + timing, marks, negative_marking, cutoffs)
- `mock_attempts` (user, template, answers[], per_question_time[], marked[], score, sectional_scores, submitted_at, autosaved_state)

## 7. Feature specs

### 7a. Onboarding + adaptive plan
Pick exam + exam date + language → generate a day-by-day plan from that exam's syllabus and pattern, sized to the date. Plan re-adapts as weak areas emerge (from quizzes + mocks).

### 7b. Topic study loop
Topic → YouTube search (whitelist ranking) → `VideoIngestor` (transcript) → `Brain` notes + quiz + cards (served from `content_cache` if present, else generate-and-cache) → user answers → `Brain` grades free text + explains → wrong answers become FSRS cards.

### 7c. Daily current affairs (exam-targeted)
- **Scheduled pipeline (Cloud Scheduler):** aggregate public/primary sources (PIB, RBI, ministry releases, reputable news via RSS/news APIs) → `CurrentAffairsIngestor` summarizes each item **in its own words + source link** → tag by subject, region (national/state/international), and **exam-relevance** (learned from each exam's PYQ patterns) → store per date.
- **Per-exam daily view:** the user's exam selects and frames items (one event can be a fact-MCQ for SSC vs an analytical note for UPSC).
- **Daily loop:** digest (5–15 items) → 10 auto MCQs + flashcards (→ FSRS) → streak feeds the reward engine.
- **Compilations:** auto weekly + monthly capsules + a "last N months" revision pack sized to the exam date; a monthly CA mock.
- Generate **once per (exam-family, date)** and cache for all users of that exam.

### 7d. ★ MCQ Mock Test — CBT exam simulator (reproduce the real govt exam interface)
This must look and behave like the actual computer-based test (NTA / TCS-iON style).

**Layout**
- Center: current question (stem + 4 options, radio select).
- Right: **question palette/grid** — numbered buttons, color-coded by status, with a legend.
- Top: **section tabs**, a **countdown timer**, a **language toggle (EN/HI)**, and a candidate-style header.

**Question statuses** (standard CBT set, color-coded): Not Visited · Not Answered (visited, skipped) · Answered · Marked for Review · Answered & Marked for Review.

**Controls:** Save & Next · Clear Response · Mark for Review & Next · Previous · jump via palette.

**Timing & rules (from the exam's `mock_template`):** total-duration countdown; optional **sectional timers/locks** where the exam uses them; **auto-submit at 00:00**. Apply that exam's **marks/question**, **negative marking** (e.g., −0.25 / −0.33 / 0 for no-negative exams like CIL), **sectional cutoffs**, and **question count** exactly.

**Submission:** confirm dialog showing per-section answered/marked/not-visited counts → compute total score **with negative marking**, sectional scores, pass/fail vs cutoffs.

**Results & analysis:** overall score + accuracy; per-section and per-subject breakdown; **time-per-question**; trend vs past attempts; full review of every question (your answer, correct answer, explanation, source); **wrong answers auto-added as FSRS cards**; weak subjects feed the adaptive plan.

**Modes:** **Exam mode** (strict, timed, no instant feedback, auto-submit) and **Practice mode** (untimed, instant per-question feedback). Test types: **full-length mock**, sectional, topic-wise, **daily CA quiz**, **PYQ-only set**.

**Robustness:** autosave answers + remaining time server-side so an accidental refresh/disconnect never loses the attempt; resume into the exact state.

### 7e. Flashcards + FSRS
All generated/missed items become FSRS-scheduled cards; daily review queue; ties into streak/XP.

### 7f. Reward + adaptivity
XP, daily streak, per-subject mastery (rolling accuracy × FSRS retention); the engine surfaces the weakest/most-overdue next action and re-plans from quiz + mock weak areas. Dashboard with mastery heatmap, mock score trend, and predicted readiness.

## 8. Milestones (build in order; commit + a one-line demo note each)
- **M0** Scaffold: React+TS+Tailwind front; FastAPI on Cloud Run; Postgres; auth skeleton; config-driven exam loader; `/health`.
- **M1** Exam-taxonomy engine + onboarding (pick exam/date → personalized plan).
- **M2** Topic study loop + `content_cache` (transcript ingest → notes/quiz/cards via `Brain`; grading).
- **M3** Flashcards + FSRS; wrong answers → cards.
- **M4** Daily current-affairs pipeline (scheduled) → digest → CA quiz/cards, cached per exam-family.
- **M5** ★ **MCQ Mock simulator** (full §7d: CBT UI, per-exam rules, negative marking, bilingual, autosave, submission, analysis).
- **M6** Reward + adaptivity + analytics dashboard.
- **M7** Tiers/monetization plumbing (free/paid; optional BYOK free tier) + content-cache cost controls.
- **M8** Polish + deploy (Cloud Run, Cloud Scheduler, logging/metrics, README for both deploy + content ops).

## 9. Quality bar
Strict TS (no `any`), small typed modules, real error handling + loading/empty states, accessible + responsive UI (mocks usable on mobile too), robust LLM-JSON parsing (strip fences, validate, retry once), no secrets in code or logs, clear README. Pattern correctness and content accuracy over speed.

## 10. Ask me before assuming (only these)
- **Default model IDs** for Claude and Gemini (I'll confirm current ones — don't guess/hardcode; config with placeholders).
- **First exam to fully implement** (recommend the technical-PSU niche, e.g. CIL MT Systems, since real PYQs + pattern are available).
- **DB choice** confirm: Postgres (default) or Firestore?
- **Auth provider** preference, and **visual theme** (else clean dark developer aesthetic).

**Start now:** restate your M0 + M1 plan, then build **M0 and M1**. Show me the result and pause for review before M2.
