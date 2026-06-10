# GovPrep — Feature Set (v3, Claude-only)

Locked 2026-06-10. All AI features run on the Anthropic API (BYOK). Expensive artifacts are
cached (Dexie locally; Supabase `content_cache` shared across users when signed in).

## AI study core
1.  **AI Study Notes** — per-topic structured notes + key points, syllabus-grounded, cached.
2.  **AI Topic Quiz** — 10 questions (7 MCQ + 3 short answer) with explanations.
3.  **AI Grading** — free-text answers graded by Claude with partial credit + feedback.
4.  **AI Homework Sets** — 5 exam-difficulty problems + answer key per topic.
5.  **AI Flashcards** — 5 per topic; every wrong quiz answer auto-becomes a card.
6.  **FSRS Spaced Repetition** — `ts-fsrs` scheduling, due-card review queue, 4-button rating.
7.  **AI Doubt-Solver Chat** — streaming, topic-aware Q&A.
8.  **AI Mnemonics Generator** — memory hooks for any topic on demand.
9.  **Smart Revision Mix** — auto-built quiz from your weakest topics.
10. **Daily Current Affairs Digest** — AI digest per day + exam family, cached/shared.
11. **Current Affairs Quiz** — daily questions generated from the digest.
12. **Lecture Link-outs** — curated YouTube searches across whitelisted channels.

## CBT mock engine
13. **Mock Simulator** — exact exam pattern (papers, marks, negative marking, total timer).
14. **Question Palette** — CBT states: not visited / unanswered / answered / marked.
15. **Mark for Review + Clear Response** — real CBT flow.
16. **Crash-safe Autosave** — resume mid-mock after a reload; auto-submit at time expiry.
17. **Mock Analytics** — score, sectional breakdown, accuracy, time per question.
18. **Mock History** — past attempts with score trend.

## Progress & engagement
19. **XP, Levels & Streaks** — daily streak with earned streak-freezes.
20. **Subject Mastery Tracking** — quiz/mock-driven mastery per subject with decay.
21. **Adaptive Next Topic** — weakest + most-overdue recommendation.
22. **Activity Heatmap** — GitHub-style 90-day study heatmap.
23. **Progress Charts** — per-subject mastery bars + XP curve (dependency-free SVG).
24. **Achievements** — badge catalog (first quiz, 7-day streak, mock milestones, …).
25. **Pomodoro Timer** — focus sessions logged to activity/XP.
26. **Exam Countdown + Daily Goal** — days-to-exam banner and a daily XP goal ring.

## Platform
27. **Hindi/English Toggle** — generated content in either language (taxonomy supports both).
28. **Backup Export/Import** — full JSON dump/restore of all local data.
29. **Keyboard Shortcuts** — 1-4 answer select, arrows/enter navigation in quiz/mock/review.
30. **PWA** — installable, offline app shell.

Platform infra (beyond the 30): GitHub OAuth sign-in (Supabase) with profile/plan cloud sync and
the shared `content_cache` so one user's generated topic content benefits everyone on that exam.
