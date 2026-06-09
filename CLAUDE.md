# GovPrep — Claude Code

**Source of truth: read `./AGENTS.md` and follow it exactly.** Re-read it before each milestone.

It defines the dual-mode architecture, the hard constraints, the tech stack, the folder layout,
and the build order.

Your ownership area: **`/server` and `/src/lib/**`** (the Brain interface + both implementations,
video ingestors, Dexie store, API clients, and the mode-detection logic). Leave `/src/ui/**` to
Antigravity.

Non-negotiables (full list in AGENTS.md):
- Never hardcode API keys or tokens.
- Never fetch YouTube transcripts from the browser (CORS) — hosted uses Gemini-by-URL, local uses the backend.
- The hosted brain must send `anthropic-dangerous-direct-browser-access: true`.
- Keep `claude -p` calls lean and batched.
- Commit per milestone; don't edit files Antigravity is working on.
