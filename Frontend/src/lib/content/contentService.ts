import { db } from '../store/db';
import type { CachedContent } from '../store/db';
import { sharedCacheGet, sharedCachePut } from '../store/sharedCache';
import { getBrain } from '../brain/anthropicBrain';
import type { BrainContext, StudyBundle } from '../brain/types';
import { AnthropicError, claudeJson } from '../api/anthropicClient';
import { MODELS } from '../config/models';
import type { ExamTaxonomy, ExamTopic, LanguageCode } from '../types/exam';
import type { Notes, QuizQuestion } from '../types/content';

/**
 * AI content service — the cache-first front door for every expensive artifact.
 *
 * Resolution order (spec §2 / AGENTS.md): local Dexie cache → shared Supabase
 * `content_cache` → one lean, batched Brain/Claude call. Every generated artifact
 * is written to Dexie before returning, and pushed to the shared cache best-effort
 * so one user's spend benefits everyone on the same exam family.
 */

const LANGUAGE_NAME: Record<LanguageCode, string> = { en: 'English', hi: 'Hindi' };

/** Dexie primary key for a cached study bundle. */
function bundleId(exam: ExamTaxonomy, topicId: string, language: LanguageCode): string {
  return `${exam.family}|${topicId}|bundle|${language}`;
}

function brainContext(topic: ExamTopic, language: LanguageCode): BrainContext {
  return {
    language,
    topicId: topic.id,
    topicName: topic.name,
    syllabusText: topic.syllabusText,
  };
}

/** Best-effort Dexie write — a failed local write must not lose a freshly generated artifact. */
async function putLocal(
  id: string,
  exam: ExamTaxonomy,
  topicId: string,
  type: CachedContent['type'],
  language: LanguageCode,
  content: unknown,
): Promise<void> {
  try {
    await db.contentCache.put({
      id,
      examFamily: exam.family,
      topicId,
      type,
      language,
      content,
      createdAt: Date.now(),
    });
  } catch {
    // IndexedDB unavailable/full — the caller still gets the content this session.
  }
}

/**
 * A bundle is usable only with non-empty notes AND at least one quiz question.
 * Off-shape model output maps to empty defaults in the brain, so without this
 * gate a degenerate bundle would be cached forever (locally and in the shared
 * Supabase cache, whose insert-only versioning makes the first write permanent).
 */
function isUsableBundle(b: unknown): b is StudyBundle {
  const x = b as StudyBundle | null | undefined;
  return (
    !!x &&
    typeof x.notes?.summaryMarkdown === 'string' &&
    x.notes.summaryMarkdown.trim().length > 0 &&
    Array.isArray(x.quiz?.questions) &&
    x.quiz.questions.length > 0
  );
}

/**
 * Get the full study bundle (notes + quiz + cards) for a topic, generating it at
 * most once per (exam family, topic, language). Order: Dexie → shared cache →
 * `Brain.makeStudyBundle` (syllabus-grounded, no transcript). Generated bundles
 * are validated (never cache a degenerate/empty bundle), cached in Dexie (record
 * type 'notes'), and shared best-effort.
 */
export async function getStudyBundle(
  exam: ExamTaxonomy,
  topic: ExamTopic,
  language: LanguageCode,
): Promise<StudyBundle> {
  const id = bundleId(exam, topic.id, language);
  const local = await db.contentCache.get(id);
  if (local && isUsableBundle(local.content)) return local.content;
  if (local) await db.contentCache.delete(id).catch(() => {}); // purge poisoned entry

  const sharedKey = { examFamily: exam.family, topicId: topic.id, type: 'notes', language };
  const shared = await sharedCacheGet<StudyBundle>(sharedKey);
  if (isUsableBundle(shared)) {
    await putLocal(id, exam, topic.id, 'notes', language, shared);
    return shared;
  }

  const bundle = await getBrain().makeStudyBundle('', brainContext(topic, language));
  if (!isUsableBundle(bundle)) {
    throw new AnthropicError(0, 'Claude returned an incomplete study unit — please retry.');
  }
  await putLocal(id, exam, topic.id, 'notes', language, bundle);
  await sharedCachePut(sharedKey, bundle);
  return bundle;
}

/**
 * Get the homework set (markdown: 5 exam-difficulty problems + answer key) for a
 * topic, cached per (exam family, topic, language). Order: Dexie (record type
 * 'homework-md') → shared cache (type 'homework') → `Brain.makeHomework(notes)`.
 */
export async function getHomework(
  exam: ExamTaxonomy,
  topic: ExamTopic,
  notes: Notes,
  language: LanguageCode,
): Promise<string> {
  const id = `${exam.family}|${topic.id}|homework-md|${language}`;
  const local = await db.contentCache.get(id);
  if (local && typeof local.content === 'string') return local.content;

  const sharedKey = { examFamily: exam.family, topicId: topic.id, type: 'homework', language };
  const shared = await sharedCacheGet<string>(sharedKey);
  if (typeof shared === 'string' && shared.trim().length > 0) {
    await putLocal(id, exam, topic.id, 'homework-md', language, shared);
    return shared;
  }

  const markdown = await getBrain().makeHomework(notes, brainContext(topic, language));
  await putLocal(id, exam, topic.id, 'homework-md', language, markdown);
  await sharedCachePut(sharedKey, markdown);
  return markdown;
}

/**
 * Get 5-8 vivid mnemonics/memory hooks for a topic (feature #8), cached per
 * (exam family, topic, language) as record type 'mnemonics'. Uses the cheap
 * routine model with a small token budget — one short JSON call, never repeated
 * for the same key.
 */
export async function getMnemonics(
  exam: ExamTaxonomy,
  topic: ExamTopic,
  language: LanguageCode,
): Promise<string[]> {
  const id = `${exam.family}|${topic.id}|mnemonics|${language}`;
  const local = await db.contentCache.get(id);
  if (local && Array.isArray(local.content) && local.content.length > 0) {
    return local.content as string[];
  }

  const sharedKey = { examFamily: exam.family, topicId: topic.id, type: 'mnemonics', language };
  const shared = await sharedCacheGet<string[]>(sharedKey);
  if (Array.isArray(shared) && shared.length > 0) {
    await putLocal(id, exam, topic.id, 'mnemonics', language, shared);
    return shared;
  }

  const raw = await claudeJson<{ mnemonics: string[] }>({
    model: MODELS.routine,
    system: [
      'You are GovPrep, an expert memory coach for Indian government/PSU competitive exams.',
      `Write all user-facing text in ${LANGUAGE_NAME[language] ?? 'English'}.`,
      'Respond with STRICT JSON only — no markdown fences, no prose outside the JSON.',
    ].join(' '),
    maxTokens: 800,
    temperature: 0.7,
    messages: [
      {
        role: 'user',
        content: `Create 5-8 vivid, memorable mnemonics/memory hooks (acronyms, mini-stories, imagery, rhymes) for the hardest-to-remember facts of this exam topic.

TOPIC: ${topic.name}
SYLLABUS SCOPE: ${topic.syllabusText}

Each entry must be self-contained: the hook itself plus a one-line note of exactly what it encodes.

Return JSON: { "mnemonics": ["...", "..."] }`,
      },
    ],
  });

  const mnemonics = (raw.mnemonics ?? [])
    .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
    .slice(0, 8);
  // Never cache an empty result (matching the shared-cache read guard above) —
  // otherwise every retry would hit the empty cache and the model is never re-asked.
  if (mnemonics.length > 0) {
    await putLocal(id, exam, topic.id, 'mnemonics', language, mnemonics);
    await sharedCachePut(sharedKey, mnemonics);
  }
  return mnemonics;
}

/**
 * Build a Smart Revision Mix (feature #9) from the user's weakest topics by
 * interleaving the quiz questions of LOCALLY CACHED bundles round-robin — one
 * question per topic per round — capped at `maxQuestions`. Never generates
 * content: topics without a cached bundle are skipped, and an empty array is
 * returned when nothing is cached.
 */
export async function buildRevisionMix(
  exam: ExamTaxonomy,
  weakTopicIds: string[],
  language: LanguageCode,
  maxQuestions = 10,
): Promise<QuizQuestion[]> {
  const topicIds = Array.from(new Set(weakTopicIds));
  const records = await Promise.all(
    topicIds.map((topicId) => db.contentCache.get(bundleId(exam, topicId, language))),
  );

  const pools: QuizQuestion[][] = [];
  for (const record of records) {
    const bundle = record?.content as StudyBundle | undefined;
    const questions = bundle?.quiz?.questions;
    if (questions && questions.length > 0) pools.push(questions);
  }
  if (pools.length === 0) return [];

  const mix: QuizQuestion[] = [];
  for (let round = 0; mix.length < maxQuestions; round++) {
    let drew = false;
    for (const pool of pools) {
      if (mix.length >= maxQuestions) break;
      if (round < pool.length) {
        mix.push(pool[round]);
        drew = true;
      }
    }
    if (!drew) break;
  }
  return mix;
}

/**
 * Whether a USABLE study bundle for the topic is already in the local Dexie cache.
 * Poisoned/degenerate entries report false so the UI shows the Generate button
 * again instead of silently treating the topic as ready.
 */
export async function hasCachedBundle(
  exam: ExamTaxonomy,
  topicId: string,
  language: LanguageCode,
): Promise<boolean> {
  const rec = await db.contentCache.get(bundleId(exam, topicId, language));
  return rec !== undefined && isUsableBundle(rec.content);
}
