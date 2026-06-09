import type {
  ExamTaxonomy,
  ExamPaper,
  ExamSubject,
  ExamTopic,
  LanguageCode,
  TopicImportance,
  VerificationStatus,
} from '../types/exam';

/**
 * Runtime validation of an exam taxonomy loaded from JSON. Catches the failure modes
 * that a config-driven model invites: dangling subject/paper references, duplicate ids,
 * and a paper qcount that doesn't sum to the pattern total. Throws with a precise message
 * (fail fast in dev) rather than letting a malformed exam silently break the plan/mock.
 */

const LANGS: readonly LanguageCode[] = ['en', 'hi'];
const IMPORTANCE: readonly TopicImportance[] = ['high', 'medium', 'low'];
const VERIFICATION: readonly VerificationStatus[] = ['verified', 'partial', 'unverified'];

function fail(examId: string, msg: string): never {
  throw new Error(`[taxonomy] exam "${examId}": ${msg}`);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function validateExamTaxonomy(input: unknown): ExamTaxonomy {
  if (!isObj(input)) throw new Error('[taxonomy] exam definition must be an object');
  const id = typeof input.id === 'string' ? input.id : '<unknown>';

  for (const key of ['id', 'name', 'shortName', 'body', 'family', 'category'] as const) {
    if (typeof input[key] !== 'string' || (input[key] as string).length === 0) {
      fail(id, `missing/empty string field "${key}"`);
    }
  }

  const languages = input.languages;
  if (!Array.isArray(languages) || languages.length === 0 || !languages.every((l) => LANGS.includes(l as LanguageCode))) {
    fail(id, `"languages" must be a non-empty array of ${LANGS.join('|')}`);
  }

  const pattern = input.pattern;
  if (!isObj(pattern)) fail(id, 'missing "pattern"');
  const papers = pattern.papers;
  if (!Array.isArray(papers) || papers.length === 0) fail(id, 'pattern.papers must be a non-empty array');

  const subjects = input.subjects;
  if (!Array.isArray(subjects) || subjects.length === 0) fail(id, '"subjects" must be a non-empty array');
  const topics = input.topics;
  if (!Array.isArray(topics) || topics.length === 0) fail(id, '"topics" must be a non-empty array');

  const paperIds = new Set<string>();
  for (const p of papers as ExamPaper[]) {
    if (!p || typeof p.id !== 'string') fail(id, 'a paper is missing an id');
    if (paperIds.has(p.id)) fail(id, `duplicate paper id "${p.id}"`);
    paperIds.add(p.id);
    if (typeof p.qcount !== 'number' || p.qcount <= 0) fail(id, `paper "${p.id}" has invalid qcount`);
    if (typeof p.marksPerQuestion !== 'number') fail(id, `paper "${p.id}" has invalid marksPerQuestion`);
    if (typeof p.negativeMarking !== 'number' || p.negativeMarking < 0) fail(id, `paper "${p.id}" has invalid negativeMarking`);
    if (!Array.isArray(p.subjectIds)) fail(id, `paper "${p.id}" missing subjectIds[]`);
  }

  const subjectIds = new Set<string>();
  for (const s of subjects as ExamSubject[]) {
    if (!s || typeof s.id !== 'string') fail(id, 'a subject is missing an id');
    if (subjectIds.has(s.id)) fail(id, `duplicate subject id "${s.id}"`);
    subjectIds.add(s.id);
    if (!paperIds.has(s.paperId)) fail(id, `subject "${s.id}" references unknown paperId "${s.paperId}"`);
  }

  // Every paper.subjectIds entry must resolve to a real subject.
  for (const p of papers as ExamPaper[]) {
    for (const sid of p.subjectIds) {
      if (!subjectIds.has(sid)) fail(id, `paper "${p.id}" lists unknown subject "${sid}"`);
    }
  }

  const topicIds = new Set<string>();
  for (const t of topics as ExamTopic[]) {
    if (!t || typeof t.id !== 'string') fail(id, 'a topic is missing an id');
    if (topicIds.has(t.id)) fail(id, `duplicate topic id "${t.id}"`);
    topicIds.add(t.id);
    if (!subjectIds.has(t.subjectId)) fail(id, `topic "${t.id}" references unknown subjectId "${t.subjectId}"`);
    if (!IMPORTANCE.includes(t.importance)) fail(id, `topic "${t.id}" has invalid importance "${String(t.importance)}"`);
  }

  // qcount sanity: sum of paper qcounts should equal pattern.totalQuestions (when provided).
  const summed = (papers as ExamPaper[]).reduce((n, p) => n + p.qcount, 0);
  if (typeof pattern.totalQuestions === 'number' && pattern.totalQuestions !== summed) {
    fail(id, `pattern.totalQuestions (${pattern.totalQuestions}) != sum of paper qcounts (${summed})`);
  }

  const meta = input.meta;
  if (!isObj(meta) || !VERIFICATION.includes(meta.verification as VerificationStatus)) {
    fail(id, `meta.verification must be one of ${VERIFICATION.join('|')}`);
  }

  // Shape validated; the JSON literally matches ExamTaxonomy.
  return input as unknown as ExamTaxonomy;
}
