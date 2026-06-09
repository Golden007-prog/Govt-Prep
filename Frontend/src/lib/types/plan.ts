import type { LanguageCode } from './exam';

/** What a user does on a given plan slot. */
export type PlanItemKind = 'study' | 'revision' | 'mock' | 'current-affairs' | 'rest';

export interface PlanItem {
  /** Topic this item studies; null for non-topic items (mock / CA / rest). */
  topicId: string | null;
  subjectId: string | null;
  kind: PlanItemKind;
  title: string;
  estimatedMinutes: number;
}

export interface PlanDay {
  /** 0-based index from the plan start date. */
  dayIndex: number;
  /** ISO YYYY-MM-DD. */
  date: string;
  items: PlanItem[];
  /** Primary subject in focus that day (for the dashboard heatmap), null on rest/mixed days. */
  focusSubjectId: string | null;
}

/**
 * A day-by-day study plan sized to the gap between today and the exam date.
 * Re-adapts as weak areas emerge (M6) — regeneration bumps `generatedAt`/`version`.
 */
export interface StudyPlan {
  examId: string;
  language: LanguageCode;
  /** ISO YYYY-MM-DD. */
  startDate: string;
  /** ISO YYYY-MM-DD. */
  examDate: string;
  totalDays: number;
  days: PlanDay[];
  /** ISO datetime the plan was generated. */
  generatedAt: string;
  /** Algorithm/schema version, so old plans can be migrated/regenerated. */
  version: number;
  /** Identifier of the generation strategy used. */
  strategy: string;
}
