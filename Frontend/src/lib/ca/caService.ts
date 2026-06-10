import { db, type CaDigest } from '../store/db';
import { sharedCacheGet, sharedCachePut } from '../store/sharedCache';
import { AnthropicError, claudeJson } from '../api/anthropicClient';
import { MODELS } from '../config/models';
import type { ExamTaxonomy, LanguageCode } from '../types/exam';
import type { CurrentAffairsItem, QuizQuestion, Region, SourceRef } from '../types/content';

/**
 * Daily current-affairs digest service (FEATURES.md #10/#11).
 *
 * One LEAN claudeJson call per (date, exam-family, language) produces the day's
 * 8-item digest + 10-question quiz. The artifact is cached in Dexie (db.caDigests)
 * and the shared Supabase content_cache, so it is generated at most once per
 * exam family per day — never per user.
 *
 * The model has NO live news access: it produces an exam-oriented "revision
 * capsule" of durable, verifiable material, and every item links out to
 * PIB/official sources for verification (spec §4 — own words, never rehosted).
 */

const LANGUAGE_NAME: Record<string, string> = { en: 'English', hi: 'Hindi' };

/** Fixed link-out: items are AI revision material, verified against official sources. */
const PIB_SOURCE: SourceRef = {
  label: 'Verify on PIB/official source',
  url: 'https://pib.gov.in',
  kind: 'news',
};

const REGIONS: readonly Region[] = ['national', 'state', 'international'];

/** Today's date as a local (not UTC) YYYY-MM-DD string — digest days roll over at local midnight. */
export function todayIso(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Shape stored in the shared cache and returned by the model (pre-normalization). */
interface RawCaItem {
  summary: string;
  subject: string;
  region: string;
}

interface RawCaQuestion {
  stem: string;
  options?: string[];
  answer: string | number;
  explanation: string;
}

interface RawCaPayload {
  items: RawCaItem[];
  quiz: RawCaQuestion[];
}

function systemPrompt(language: LanguageCode): string {
  return [
    'You are GovPrep, an expert general-awareness coach for Indian government/PSU competitive exams.',
    'You compile EXAM REVISION CAPSULES from durable, well-established, verifiable facts — the schemes,',
    'institutions, policies, missions, appointments and milestones examiners repeatedly draw on.',
    'You are NOT reporting live news: never invent recent events, never claim knowledge you lack,',
    'and never refuse — firmly-established material from your knowledge is always the right answer.',
    'Summarize in your OWN words.',
    `Write all user-facing text in ${LANGUAGE_NAME[language] ?? 'English'}.`,
    'Respond with STRICT JSON only — no markdown fences, no prose outside the JSON.',
  ].join(' ');
}

function userPrompt(exam: ExamTaxonomy, date: string): string {
  return `Compile a daily general-awareness revision capsule for Indian competitive exams.
(The date ${date} is only a cache label — do NOT attempt to report news from that date.
Draw on durable, frequently-examined material that is firmly within your knowledge.)

TARGET EXAM: ${exam.name} (${exam.body}) — family: ${exam.family}

Return JSON exactly in this shape:
{
  "items": [
    // exactly 8 items, one per area, covering in order: government schemes, economy/RBI,
    // science & technology, defence, appointments/awards, sports, environment, polity/governance.
    // "summary": 2-3 sentences in your own words, exam-ready (names, bodies, figures, why it matters).
    // "subject": short label, e.g. "Economy". "region": one of "national" | "state" | "international".
    { "summary": "...", "subject": "...", "region": "national" }
  ],
  "quiz": [
    // exactly 10 MCQs testing the items above (the daily plan promises "digest + 10 MCQs"),
    // exam difficulty. "answer" is the correct option index as a string, e.g. "2".
    { "stem": "...", "options": ["...","...","...","..."], "answer": "0", "explanation": "why correct + why others wrong" }
  ]
}`;
}

function toItems(raw: RawCaItem[], exam: ExamTaxonomy, date: string, language: LanguageCode): CurrentAffairsItem[] {
  return (raw ?? []).map((item, i) => ({
    id: `${date}-ca-${i}`,
    date,
    summary: item.summary ?? '',
    source: PIB_SOURCE,
    subject: item.subject ?? 'General',
    region: REGIONS.includes(item.region as Region) ? (item.region as Region) : 'national',
    examRelevance: [exam.family],
    language,
  }));
}

function toQuiz(raw: RawCaQuestion[], date: string): QuizQuestion[] {
  return (raw ?? []).map((q, i) => ({
    id: `${date}-caq-${i}`,
    type: 'mcq' as const,
    stem: q.stem ?? '',
    options: q.options ?? [],
    answer: String(q.answer ?? '0'),
    explanation: q.explanation ?? '',
    sources: [],
    origin: 'ai' as const,
  }));
}

function buildDigest(
  exam: ExamTaxonomy,
  language: LanguageCode,
  date: string,
  items: CurrentAffairsItem[],
  quiz: QuizQuestion[],
): CaDigest {
  return {
    id: `${date}|${exam.family}|${language}`,
    date,
    examFamily: exam.family,
    language,
    items,
    quiz,
    createdAt: Date.now(),
  };
}

/**
 * Get the current-affairs digest for a day (defaults to today). Resolution order:
 * local Dexie (db.caDigests) → shared Supabase cache → ONE batched claudeJson
 * generation (MODELS.routine), which is then persisted to both caches.
 * `opts.force` skips both caches and regenerates (the "Regenerate" affordance).
 */
export async function getDigest(
  exam: ExamTaxonomy,
  language: LanguageCode,
  date?: string,
  opts?: { force?: boolean },
): Promise<CaDigest> {
  const day = date ?? todayIso();
  const id = `${day}|${exam.family}|${language}`;
  const force = opts?.force === true;

  // 1) Local cache. Purge (don't serve) empty rows persisted by pre-guard builds,
  // so the day regenerates instead of rendering a permanently blank digest.
  const local = force ? undefined : await db.caDigests.get(id);
  if (local && local.items.length > 0 && local.quiz.length > 0) return local;
  if (local) {
    try {
      await db.caDigests.delete(id);
    } catch {
      // Best-effort purge; generation below will overwrite it anyway.
    }
  }

  const cacheKey = { examFamily: exam.family, topicId: day, type: 'ca-digest', language } as const;

  // 2) Shared cross-user cache (content = { items, quiz }) — ignore empty/poisoned
  // rows so regeneration proceeds instead of persisting a blank day locally.
  const shared = force
    ? null
    : await sharedCacheGet<{ items: CurrentAffairsItem[]; quiz: QuizQuestion[] }>(cacheKey);
  if (
    shared &&
    Array.isArray(shared.items) &&
    shared.items.length > 0 &&
    Array.isArray(shared.quiz) &&
    shared.quiz.length > 0
  ) {
    const digest = buildDigest(exam, language, day, shared.items, shared.quiz);
    await db.caDigests.put(digest);
    return digest;
  }

  // 3) Generate — one lean call for the whole day's items + quiz.
  const raw = await claudeJson<RawCaPayload>({
    model: MODELS.routine,
    system: systemPrompt(language),
    maxTokens: 6000,
    temperature: 0.5,
    messages: [{ role: 'user', content: userPrompt(exam, day) }],
  });

  const digest = buildDigest(exam, language, day, toItems(raw.items, exam, day, language), toQuiz(raw.quiz, day));
  // An off-shape (but parseable) response yields empty items/quiz — surface it as a
  // retryable error BEFORE either write, or the empty digest is permanent for this
  // date locally and poisons the shared cache for every user of the exam family.
  if (digest.items.length === 0 || digest.quiz.length === 0) {
    throw new AnthropicError(0, 'CA generation returned an empty digest — please retry.');
  }
  await db.caDigests.put(digest);
  await sharedCachePut(cacheKey, { items: digest.items, quiz: digest.quiz });
  return digest;
}

/**
 * Recent digests for this exam family + language, newest first — Dexie only
 * (no network/AI calls), so it is safe for dashboards and history views.
 */
export async function getRecentDigests(exam: ExamTaxonomy, language: LanguageCode, limit = 7): Promise<CaDigest[]> {
  return db.caDigests
    .orderBy('date')
    .reverse()
    .filter((d) => d.examFamily === exam.family && d.language === language)
    .limit(limit)
    .toArray();
}

/** Convenience accessor: the daily quiz questions bundled in a digest (FEATURES.md #11). */
export function caQuizForDigest(digest: CaDigest): QuizQuestion[] {
  return digest.quiz;
}
