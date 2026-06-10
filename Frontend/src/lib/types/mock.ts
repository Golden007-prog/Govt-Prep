import type { LanguageCode } from './exam';
import type { QuizQuestion } from './content';

/**
 * CBT mock simulator types. Pattern correctness is SACRED (AGENTS.md): section/question
 * counts, marks, negative marking and timing come from the ExamTaxonomy verbatim.
 */

export interface MockSection {
  paperId: string;
  name: string;
  qcount: number;
  marksPerQuestion: number;
  negativeMarking: number;
  /** Sectional limit in minutes; null = shares the global clock. */
  durationMinutes: number | null;
  subjectIds: string[];
}

/** A generated, reusable mock paper (cached so re-attempts cost zero AI calls). */
export interface MockPaper {
  id: string; // `${examId}|${language}|v${n}`
  examId: string;
  language: LanguageCode;
  sections: MockSection[];
  /** Flattened questions; q.sectionIndex maps into `sections`. */
  questions: MockQuestion[];
  totalDurationMinutes: number;
  createdAt: number;
}

export interface MockQuestion extends QuizQuestion {
  sectionIndex: number;
}

/** CBT palette states (real exam semantics). */
export type MockQuestionState =
  | 'not-visited'
  | 'unanswered'
  | 'answered'
  | 'marked'
  | 'answered-marked';

/** Persisted attempt — autosaved continuously for crash-safe resume. */
export interface MockAttemptRecord {
  id?: number;
  examId: string;
  paperId: string;
  language: LanguageCode;
  startedAt: number;
  submittedAt: number | null;
  /** questionId → chosen option index (as string) or free text. */
  answers: Record<string, string>;
  /** questionId → palette state. */
  states: Record<string, MockQuestionState>;
  /** questionId → seconds spent. */
  perQuestionSeconds: Record<string, number>;
  currentIndex: number;
  remainingSeconds: number;
  score: number | null;
  analytics: MockAnalytics | null;
}

export interface MockSectionAnalytics {
  paperId: string;
  name: string;
  score: number;
  maxScore: number;
  attempted: number;
  correct: number;
  wrong: number;
  skipped: number;
}

export interface MockAnalytics {
  totalScore: number;
  maxScore: number;
  /** correct / attempted, 0..1; 0 when nothing attempted. */
  accuracy: number;
  attempted: number;
  correct: number;
  wrong: number;
  skipped: number;
  avgSecondsPerQuestion: number;
  totalSeconds: number;
  perSection: MockSectionAnalytics[];
}
