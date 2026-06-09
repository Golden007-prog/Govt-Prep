/**
 * Typed access to build-time environment (Vite `import.meta.env`, VITE_-prefixed).
 *
 * NO SECRETS LIVE HERE. The Supabase anon key is publishable (RLS protects data).
 * Operator LLM keys never reach the browser — they live in Supabase Edge Function
 * secrets (hosted) or the local backend's env (local). See AGENTS.md "Hard constraints".
 *
 * Model ids default to the current recommended ids but are env-overridable; confirm
 * them before deploy (spec §10 — "don't hardcode; config with placeholders").
 */

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

const e = import.meta.env;

export const ENV = {
  // --- Supabase (hosted backend). Empty until a project is wired (deploy = M8). ---
  supabaseUrl: str(e.VITE_SUPABASE_URL, ''),
  supabaseAnonKey: str(e.VITE_SUPABASE_ANON_KEY, ''),

  // --- Local backend (Node/Fastify) used by local/desktop mode. ---
  localBackendUrl: str(e.VITE_LOCAL_BACKEND_URL, 'http://localhost:8787'),

  // --- Model ids (override per environment; current as of build — confirm before deploy). ---
  /** Cheap, batched routine generation: notes + quiz + cards, CA summaries. */
  claudeModelRoutine: str(e.VITE_CLAUDE_MODEL_ROUTINE, 'claude-haiku-4-5-20251001'),
  /** Higher quality: free-text grading + structured generation. */
  claudeModelGrading: str(e.VITE_CLAUDE_MODEL_GRADING, 'claude-sonnet-4-6'),
  /** Gemini for transcript/video/CA summarization (Vertex server-side, or browser BYOK). */
  geminiModel: str(e.VITE_GEMINI_MODEL, 'gemini-2.5-flash'),

  /** Vite base path (kept in sync with vite.config.ts `base`). */
  basePath: str(e.BASE_URL, '/'),
  isDev: e.DEV === true,
} as const;

export type Env = typeof ENV;
