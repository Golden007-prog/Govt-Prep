import { claudeJson } from '../api/anthropicClient';
import { MODELS } from '../config/models';
import { db, type CachedContent } from '../store/db';
import { sharedCacheGet, sharedCachePut } from '../store/sharedCache';
import type { ExamTaxonomy, LanguageCode } from '../types/exam';
import type {
  MockAnalytics,
  MockAttemptRecord,
  MockPaper,
  MockQuestion,
  MockQuestionState,
  MockSection,
  MockSectionAnalytics,
} from '../types/mock';

/**
 * CBT mock engine (FEATURES.md #13-18): builds full-pattern mock papers, persists crash-safe
 * attempts, and scores/analyzes submissions. Pattern correctness is SACRED — sections are
 * copied VERBATIM from ExamTaxonomy.pattern.papers (counts, marks, negatives, timing).
 * Papers are expensive AI artifacts: generated once per (exam, language), cached in Dexie
 * (db.contentCache) and best-effort in the shared Supabase cache, so re-attempts are free.
 */

const QUESTIONS_PER_CALL = 20;
const PAPER_VERSION = 1;

const LANGUAGE_NAME: Record<string, string> = { en: 'English', hi: 'Hindi' };

// Dexie contentCache id for a cached mock paper: `mock|${examId}|${language}|v1`.
function paperCacheId(examId: string, language: LanguageCode): string {
  return `mock|${examId}|${language}|v${PAPER_VERSION}`;
}

// Loose shape check so a corrupt/legacy cache entry triggers regeneration instead of a crash.
function isMockPaper(value: unknown): value is MockPaper {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<MockPaper>;
  return Array.isArray(p.sections) && Array.isArray(p.questions) && p.questions.length > 0;
}

// Sections come VERBATIM from the exam pattern — never invent or reshape these numbers.
function buildSections(exam: ExamTaxonomy): MockSection[] {
  return exam.pattern.papers.map((p) => ({
    paperId: p.id,
    name: p.name,
    qcount: p.qcount,
    marksPerQuestion: p.marksPerQuestion,
    negativeMarking: p.negativeMarking,
    durationMinutes: p.durationMinutes,
    subjectIds: [...p.subjectIds],
  }));
}

// Named syllabus areas ("Subject — Topic") for a section, used to spread question coverage.
function sectionAreas(exam: ExamTaxonomy, section: MockSection): string[] {
  const areas: string[] = [];
  for (const subjectId of section.subjectIds) {
    const subject = exam.subjects.find((s) => s.id === subjectId);
    const name = subject?.name ?? subjectId;
    const topics = exam.topics
      .filter((t) => t.subjectId === subjectId)
      .sort((a, b) => a.order - b.order);
    if (topics.length === 0) {
      areas.push(name);
    } else {
      for (const topic of topics) areas.push(`${name} — ${topic.name}`);
    }
  }
  return areas;
}

// Round-robin slice of areas so successive batches emphasize different parts of the syllabus
// without re-sending earlier questions (keeps every call lean).
function pickAreas(areas: string[], plannedBatches: number, call: number): string[] {
  if (plannedBatches <= 1 || areas.length === 0) return areas;
  const slice = areas.filter((_, i) => i % plannedBatches === call % plannedBatches);
  return slice.length > 0 ? slice : areas;
}

function systemPrompt(language: LanguageCode): string {
  return [
    'You are GovPrep, an expert question-setter for Indian government/PSU competitive exams.',
    'You write exam-accurate multiple-choice questions at real exam difficulty.',
    `Write all user-facing text in ${LANGUAGE_NAME[language] ?? 'English'}.`,
    'Respond with STRICT JSON only — no markdown fences, no prose outside the JSON.',
  ].join(' ');
}

function batchPrompt(
  exam: ExamTaxonomy,
  section: MockSection,
  need: number,
  produced: number,
  areas: string[],
): string {
  const areaLines = areas
    .slice(0, 30)
    .map((a) => `- ${a}`)
    .join('\n');
  return `Write exactly ${need} multiple-choice questions for one section of a full mock test.

EXAM: ${exam.name} (${exam.body})
SECTION: ${section.name} — questions ${produced + 1}-${produced + need} of ${section.qcount}
COVER THESE SYLLABUS AREAS (spread the ${need} questions evenly across them; no duplicates):
${areaLines}

Rules:
- Real exam difficulty and style; facts and computations must be correct.
- Each question: a self-contained stem, exactly 4 plausible options, exactly one correct.
- "answer" is the correct option index as a string ("0"-"3").
- "explanation" is 1-2 sentences on why the answer is correct.

Return JSON exactly: { "questions": [ { "stem": "...", "options": ["...","...","...","..."], "answer": "0", "explanation": "..." } ] }`;
}

interface RawMockQuestion {
  stem?: string;
  options?: unknown[];
  answer?: string | number;
  explanation?: string;
}

// A raw question is usable only with a non-empty stem and at least 4 options (sliced to 4).
function isUsable(raw: RawMockQuestion): boolean {
  return (
    typeof raw.stem === 'string' &&
    raw.stem.trim().length > 0 &&
    Array.isArray(raw.options) &&
    raw.options.length >= 4
  );
}

function toMockQuestion(
  raw: RawMockQuestion,
  sectionIndex: number,
  paperId: string,
  n: number,
): MockQuestion {
  const options = (raw.options ?? []).slice(0, 4).map((o) => String(o));
  const parsed = Number.parseInt(String(raw.answer ?? '0'), 10);
  const answerIndex = Number.isNaN(parsed) ? 0 : Math.max(0, Math.min(options.length - 1, parsed));
  return {
    id: `mock-${paperId}-${n}`,
    type: 'mcq',
    stem: (raw.stem ?? '').trim(),
    options,
    answer: String(answerIndex),
    explanation: raw.explanation ?? '',
    sources: [],
    origin: 'ai',
    sectionIndex,
  };
}

async function cachePaperLocally(
  cacheId: string,
  exam: ExamTaxonomy,
  language: LanguageCode,
  paper: MockPaper,
): Promise<void> {
  const record: CachedContent = {
    id: cacheId,
    examFamily: exam.family,
    topicId: `mock|${exam.id}`,
    type: 'quiz',
    language,
    content: paper,
    createdAt: Date.now(),
  };
  await db.contentCache.put(record);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Returns the cached mock paper for (exam, language), or generates one section by section.
 * Cache order: Dexie contentCache → shared Supabase cache → generation (MODELS.routine,
 * sequential batches of up to 20 MCQs per call; `onProgress(done, total)` after each batch).
 * The generated paper is cached locally (and best-effort shared) before returning.
 */
export async function getOrBuildMockPaper(
  exam: ExamTaxonomy,
  language: LanguageCode,
  onProgress?: (done: number, total: number) => void,
): Promise<MockPaper> {
  const cacheId = paperCacheId(exam.id, language);
  const cached = await db.contentCache.get(cacheId);
  if (cached && isMockPaper(cached.content)) return cached.content;

  const sharedKey = { examFamily: exam.family, topicId: `mock|${exam.id}`, type: 'quiz', language };
  const shared = await sharedCacheGet<MockPaper>(sharedKey);
  if (shared && isMockPaper(shared)) {
    await cachePaperLocally(cacheId, exam, language, shared);
    return shared;
  }

  const sections = buildSections(exam);
  const total = sections.reduce((sum, s) => sum + s.qcount, 0);
  const questions: MockQuestion[] = [];
  let done = 0;

  for (let si = 0; si < sections.length; si++) {
    const section = sections[si];
    const areas = sectionAreas(exam, section);
    const plannedBatches = Math.max(1, Math.ceil(section.qcount / QUESTIONS_PER_CALL));
    let produced = 0;
    let call = 0;
    while (produced < section.qcount) {
      if (call >= plannedBatches * 3) {
        throw new Error(`[mock] generation stalled on section "${section.name}" — please retry.`);
      }
      const need = Math.min(QUESTIONS_PER_CALL, section.qcount - produced);
      const raw = await claudeJson<{ questions?: RawMockQuestion[] }>({
        model: MODELS.routine,
        system: systemPrompt(language),
        maxTokens: 6500,
        temperature: 0.7,
        messages: [
          {
            role: 'user',
            content: batchPrompt(exam, section, need, produced, pickAreas(areas, plannedBatches, call)),
          },
        ],
      });
      const usable = (raw.questions ?? []).filter(isUsable).slice(0, need);
      if (usable.length === 0) {
        throw new Error(`[mock] model returned no usable questions for "${section.name}" — please retry.`);
      }
      for (const q of usable) {
        questions.push(toMockQuestion(q, si, section.paperId, questions.length + 1));
      }
      produced += usable.length;
      done += usable.length;
      call++;
      onProgress?.(done, total);
    }
  }

  const paper: MockPaper = {
    id: `${exam.id}|${language}|v${PAPER_VERSION}`,
    examId: exam.id,
    language,
    sections,
    questions,
    totalDurationMinutes: exam.pattern.totalDurationMinutes,
    createdAt: Date.now(),
  };
  await cachePaperLocally(cacheId, exam, language, paper);
  await sharedCachePut(sharedKey, paper);
  return paper;
}

/**
 * Starts a fresh attempt for a paper: every question 'not-visited', no answers/timings,
 * full clock (totalDurationMinutes * 60). Persisted immediately so a crash right after
 * starting is still resumable; the generated Dexie id is set on the returned record.
 */
export async function startAttempt(paper: MockPaper): Promise<MockAttemptRecord> {
  const states: Record<string, MockQuestionState> = {};
  for (const q of paper.questions) states[q.id] = 'not-visited';
  const attempt: MockAttemptRecord = {
    examId: paper.examId,
    paperId: paper.id,
    language: paper.language,
    startedAt: Date.now(),
    submittedAt: null,
    answers: {},
    states,
    perQuestionSeconds: {},
    currentIndex: 0,
    remainingSeconds: paper.totalDurationMinutes * 60,
    score: null,
    analytics: null,
  };
  attempt.id = await db.mockAttempts.add(attempt);
  return attempt;
}

/** Autosaves an in-flight attempt (crash-safe resume). Callers debounce — this writes as-is. */
export async function saveAttempt(attempt: MockAttemptRecord): Promise<void> {
  await db.mockAttempts.put(attempt);
}

/** Latest unsubmitted attempt for an exam (the one to resume), or null when none is open. */
export async function getActiveAttempt(examId: string): Promise<MockAttemptRecord | null> {
  const rows = await db.mockAttempts.where('examId').equals(examId).toArray();
  const open = rows
    .filter((a) => a.submittedAt === null)
    .sort((a, b) => b.startedAt - a.startedAt);
  return open[0] ?? null;
}

/** Loads the cached paper an attempt was taken on, or null if the cache entry is gone. */
export async function getPaperForAttempt(attempt: MockAttemptRecord): Promise<MockPaper | null> {
  // attempt.paperId is `${examId}|${language}|v${n}` → cache id `mock|${examId}|${language}|v${n}`.
  const record = await db.contentCache.get(`mock|${attempt.paperId}`);
  if (record && isMockPaper(record.content)) return record.content;
  return null;
}

/**
 * Scores an attempt against its paper using each section's VERBATIM marking scheme
 * (correct → +marksPerQuestion, wrong → −negativeMarking, blank → 0), builds full
 * MockAnalytics (per-section breakdown, accuracy, avg seconds over attempted questions,
 * total tracked seconds), persists the submitted record and returns it.
 */
export async function submitAttempt(
  attempt: MockAttemptRecord,
  paper: MockPaper,
): Promise<MockAttemptRecord> {
  const perSection: MockSectionAnalytics[] = paper.sections.map((s) => ({
    paperId: s.paperId,
    name: s.name,
    score: 0,
    maxScore: round2(s.qcount * s.marksPerQuestion),
    attempted: 0,
    correct: 0,
    wrong: 0,
    skipped: 0,
  }));

  let attemptedSeconds = 0;

  for (const q of paper.questions) {
    const section = paper.sections[q.sectionIndex];
    const stats = perSection[q.sectionIndex];
    if (!section || !stats) continue;
    const given = attempt.answers[q.id];
    if (given === undefined || given === '') {
      stats.skipped++;
      continue;
    }
    stats.attempted++;
    attemptedSeconds += attempt.perQuestionSeconds[q.id] ?? 0;
    if (given.trim() === q.answer.trim()) {
      stats.correct++;
      stats.score += section.marksPerQuestion;
    } else {
      stats.wrong++;
      stats.score -= section.negativeMarking;
    }
  }
  for (const s of perSection) s.score = round2(s.score);

  const attempted = perSection.reduce((sum, s) => sum + s.attempted, 0);
  const correct = perSection.reduce((sum, s) => sum + s.correct, 0);
  const totalScore = round2(perSection.reduce((sum, s) => sum + s.score, 0));
  const totalSeconds = Math.round(
    Object.values(attempt.perQuestionSeconds).reduce((sum, s) => sum + s, 0),
  );

  const analytics: MockAnalytics = {
    totalScore,
    maxScore: round2(perSection.reduce((sum, s) => sum + s.maxScore, 0)),
    accuracy: attempted > 0 ? correct / attempted : 0,
    attempted,
    correct,
    wrong: perSection.reduce((sum, s) => sum + s.wrong, 0),
    skipped: perSection.reduce((sum, s) => sum + s.skipped, 0),
    avgSecondsPerQuestion: attempted > 0 ? Math.round((attemptedSeconds / attempted) * 10) / 10 : 0,
    totalSeconds,
    perSection,
  };

  const submitted: MockAttemptRecord = {
    ...attempt,
    submittedAt: Date.now(),
    score: totalScore,
    analytics,
  };
  await db.mockAttempts.put(submitted);
  return submitted;
}

/** Submitted attempts for an exam, newest first (mock history / score trend). */
export async function listAttempts(examId: string): Promise<MockAttemptRecord[]> {
  const rows = await db.mockAttempts.where('examId').equals(examId).toArray();
  return rows
    .filter((a) => a.submittedAt !== null)
    .sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0));
}

/** Deletes an unsubmitted attempt by id (no-op for submitted history or unknown ids). */
export async function abandonAttempt(id: number): Promise<void> {
  const record = await db.mockAttempts.get(id);
  if (record && record.submittedAt === null) {
    await db.mockAttempts.delete(id);
  }
}
