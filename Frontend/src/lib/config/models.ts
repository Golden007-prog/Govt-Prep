import { ENV } from './env';

/**
 * Single source of truth for model ids by role. The rest of the app references
 * MODELS.* by role, never a literal id — so swapping a model is a one-line env change.
 *
 * Claude-only architecture (v3): every AI feature runs on the Anthropic API.
 * Current recommended ids (confirm with the operator before deploy — spec §10):
 *   routine  → claude-haiku-4-5-20251001   (cheap, batched notes/quiz/cards, CA digests)
 *   grading  → claude-sonnet-4-6           (free-text grading, structured generation, doubt chat)
 */
export const MODELS = {
  routine: ENV.claudeModelRoutine,
  grading: ENV.claudeModelGrading,
} as const;

export type ModelRole = keyof typeof MODELS;
