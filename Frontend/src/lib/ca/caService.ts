import { db, type CaDigest } from '../store/db';
import { sharedCacheGet, sharedCachePut } from '../store/sharedCache';
import { claudeJson } from '../api/anthropicClient';
import { MODELS } from '../config/models';
import type { ExamTaxonomy, LanguageCode } from '../types/exam';
import type { CurrentAffairsItem, QuizQuestion, Region, SourceRef } from '../types/content';

/**
 * Daily current-affairs digest service (FEATURES.md #10/#11).
 *
 * One LEAN claudeJson call per (date, exam-family, language) produces the day's
 * 8-item digest + 6-question quiz. The artifact is cached in Dexie (db.caDigests)
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
    'You are GovPrep, an expert current-affairs coach for Indian government/PSU competitive exams.',
    'You have NO live news access. Produce an exam-oriented current-affairs REVISION CAPSULE:',
    'durable, well-established, verifiable facts of the kind examiners draw on — never invent',
    'precise event claims you cannot stand behind. Summarize in your OWN words.',
    `Write all user-facing text in ${LANGUAGE_NAME[language] ?? 'English'}.`,
    'Respond with STRICT JSON only — no markdown fences, no prose outside the JSON.',
  ].join(' ');
}

function userPrompt(exam: ExamTaxonomy, date: string): string {
  return `Create the daily current-affairs revision capsule for India as of ${date}.

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
    // exactly 6 MCQs testing the items above, exam difficulty.
    // "answer" is the correct option index as a string, e.g. "2".
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
 */
export async function getDigest(exam: ExamTaxonomy, language: LanguageCode, date?: string): Promise<CaDigest> {
  const day = date ?? todayIso();
  const id = `${day}|${exam.family}|${language}`;

  // 1) Local cache.
  const local = await db.caDigests.get(id);
  if (local) return local;

  const cacheKey = { examFamily: exam.family, topicId: day, type: 'ca-digest', language } as const;

  // 2) Shared cross-user cache (content = { items, quiz }).
  const shared = await sharedCacheGet<{ items: CurrentAffairsItem[]; quiz: QuizQuestion[] }>(cacheKey);
  if (shared && Array.isArray(shared.items) && Array.isArray(shared.quiz)) {
    const digest = buildDigest(exam, language, day, shared.items, shared.quiz);
    await db.caDigests.put(digest);
    return digest;
  }

  // 3) Generate — one lean call for the whole day's items + quiz.
  const raw = await claudeJson<RawCaPayload>({
    model: MODELS.routine,
    system: systemPrompt(language),
    maxTokens: 4000,
    temperature: 0.5,
    messages: [{ role: 'user', content: userPrompt(exam, day) }],
  });

  const digest = buildDigest(exam, language, day, toItems(raw.items, exam, day, language), toQuiz(raw.quiz, day));
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
