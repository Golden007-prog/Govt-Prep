// Exam taxonomy types — the config-driven shape that makes "adding an exam = adding data".
// Mirrors the `exams`/`subjects`/`topics` tables in the hosted Postgres schema (supabase/migrations).

/** Supported content languages. Extensible; English + Hindi are the minimum (AGENTS.md / spec §4). */
export type LanguageCode = 'en' | 'hi';

/** A single paper/section of an exam (e.g. CIL MT "Paper-I — Technical"). */
export interface ExamPaper {
  id: string;
  name: string;
  qcount: number;
  marksPerQuestion: number;
  /** Marks deducted per wrong answer. 0 = no negative marking (e.g. CIL MT). */
  negativeMarking: number;
  /** Sectional time limit in minutes; null = draws from the total duration (no sectional timing). */
  durationMinutes: number | null;
  /** Subject ids covered by this paper. */
  subjectIds: string[];
}

/**
 * The exam's real-world pattern. Per spec §4 this is "sacred": the mock simulator must
 * reproduce these numbers exactly (count, marks, negative marking, timing, languages).
 */
export interface ExamPattern {
  papers: ExamPaper[];
  totalQuestions: number;
  totalMarks: number | null;
  totalDurationMinutes: number;
  /** Global default negative marking; papers may override via ExamPaper.negativeMarking. */
  negativeMarking: number;
  hasSectionalTiming: boolean;
  /** Human-readable cutoff description; structured per-section cutoffs land in mock_templates (M5). */
  sectionalCutoffs: string | null;
  qualifyingCriteria: string | null;
}

export interface ExamSubject {
  id: string;
  name: string;
  paperId: string;
  /** Approximate share of its paper (0-100), used to weight the study plan. null = even split. */
  weightPct: number | null;
}

export type TopicImportance = 'high' | 'medium' | 'low';

export interface ExamTopic {
  id: string;
  subjectId: string;
  name: string;
  /** Ordering within the subject (lower = earlier). */
  order: number;
  /** 1-2 sentence scope of the topic, drawn from the official syllabus. */
  syllabusText: string;
  importance: TopicImportance;
}

/** How trustworthy the encoded pattern/syllabus is. Drives a visible "verify before mocks" flag. */
export type VerificationStatus = 'verified' | 'partial' | 'unverified';

export interface ExamMeta {
  verification: VerificationStatus;
  /** Source URLs (official notification, reputable portals) backing the pattern/syllabus. */
  sources: string[];
  /** ISO date the data was last human-reviewed; null until reviewed. */
  lastReviewed: string | null;
  notes?: string;
}

/** A complete, self-contained exam definition. Adding a new exam = adding one of these. */
export interface ExamTaxonomy {
  id: string;
  name: string;
  shortName: string;
  body: string;
  /** Family grouping for shared content_cache (e.g. 'cil-mt', 'ssc-cgl'). */
  family: string;
  category: string;
  languages: LanguageCode[];
  pattern: ExamPattern;
  subjects: ExamSubject[];
  topics: ExamTopic[];
  meta: ExamMeta;
}
