# GovPrep — Supabase (hosted backend)

In the **hybrid** architecture, the static SPA is served from **GitHub Pages** and **Supabase is the
hosted backend**: Postgres (the §6 data model + shared `content_cache`), **Auth** (GitHub OAuth),
**Edge Functions** (server-side LLM with operator keys — built M2+), and **pg_cron** (the daily
current-affairs pipeline — M4). The **local** mode instead uses the Node/Fastify `/Backend` + Dexie.

> All Supabase operations for this project are driven through the **Supabase MCP server**. See the
> root README for connecting it (needs a Supabase Personal Access Token + a one-time reload).

## Files
- `migrations/0001_init.sql` — full schema + Row-Level Security + a trigger that auto-creates a
  `public.users` row on signup.
- `seed.sql` — exam header rows (`exams`).
- `config.toml` — CLI/local config; GitHub OAuth reads `GITHUB_CLIENT_ID` / `GITHUB_SECRET` from env.

## Provisioning (via Supabase MCP)
1. Create the project (region **ap-south-1 / Mumbai**).
2. Apply `migrations/0001_init.sql` (MCP `apply_migration`).
3. Run `seed.sql`.
4. Enable the **GitHub** auth provider; set the OAuth callback to
   `https://<ref>.supabase.co/auth/v1/callback` and add the GitHub Pages URL to redirect URLs.
5. Copy the project URL + anon key into the frontend env (`Frontend/.env.local`):
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

## Local CLI alternative (needs Docker)
```bash
supabase start          # local Postgres + Auth + Studio
supabase db reset       # apply migrations + seed
```

## Security
- **No secrets in the repo.** Anon key is publishable (RLS protects rows). Operator LLM keys live in
  **Edge Function secrets** (`supabase secrets set ANTHROPIC_API_KEY=…`), never in the browser.
- RLS: shared content tables are world-readable + service-role-write; per-user tables are restricted
  to `auth.uid()`.
