# GovPrep — Antigravity (Gemini)

**Source of truth: read `./AGENTS.md` and follow it exactly.** Re-read it before each milestone.

It defines the dual-mode architecture, the hard constraints, the tech stack, the folder layout,
and the build order.

Your ownership area: **`/src/ui/**`** (screens, components, styling, browser-preview iteration).
Leave `/server` and `/src/lib/**` to Claude Code.

Non-negotiables (full list in AGENTS.md):
- Never hardcode API keys or tokens — read them from settings (localStorage).
- Never fetch YouTube transcripts in the browser (CORS).
- The hosted brain must send `anthropic-dangerous-direct-browser-access: true`.
- Build in milestone order; coordinate via git; don't edit files Claude Code owns.

Tip: you can also drop an always-on copy of these rules in `.agent/rules/govprep.md`
(with `trigger: always_on` frontmatter) if you want them enforced on every agent run.
