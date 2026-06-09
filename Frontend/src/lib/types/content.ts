import type { LanguageCode } from './exam';

/** Types of generated content cached per (exam-family, topic, date, version) — shared across users. */
export type ContentType = 'notes' | 'quiz' | 'cards' | 'homework' | 'ca-digest';

/** Cache key: the expensive AI work is per-(exam-family, topic) — never per user (spec §2). */
export interface ContentCacheKey {
  examFamily: string;
  topicId: string;
  type: ContentType;
  language: LanguageCode;
  version: number;
}

export type SourceKind = 'pyq' | 'video' | 'primary' | 'news' | 'other';

/** A linked-out source. We summarize in our own words and always link the original (spec §4 ToS). */
export interface SourceRef {
  label: string;
  url: string;
  kind: SourceKind;
}

export interface Notes {
  topicId: string;
  language: LanguageCode;
  summaryMarkdown: string;
  keyPoints: string[];
  sources: SourceRef[];
}

export type QuestionType = 'mcq' | 'short';

export interface QuizQuestion {
  id: string;
  type: QuestionType;
  stem: string;
  /** Present for mcq. */
  options?: string[];
  /** mcq: the correct option index as a string; short: a reference answer. */
  answer: string;
  explanation: string;
  sources: SourceRef[];
  /** Grounding: previous-year question vs AI-generated (spec §4). */
  origin: 'pyq' | 'ai';
}

export interface Quiz {
  topicId: string;
  language: LanguageCode;
  questions: QuizQuestion[];
}

export interface Flashcard {
  id: string;
  topicId: string;
  front: string;
  back: string;
  language: LanguageCode;
}

export interface GradeResult {
  questionId: string;
  correct: boolean;
  /** 0..1 partial credit for short answers. */
  score: number;
  feedback: string;
}

export type Region = 'national' | 'state' | 'international';

export interface CurrentAffairsItem {
  id: string;
  /** ISO YYYY-MM-DD. */
  date: string;
  /** Our own words, never a rehosted third-party digest (spec §4). */
  summary: string;
  source: SourceRef;
  subject: string;
  region: Region;
  /** Exam-family ids this item is relevant to. */
  examRelevance: string[];
  language: LanguageCode;
}
