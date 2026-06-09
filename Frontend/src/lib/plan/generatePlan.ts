import type { ExamTaxonomy, ExamTopic, LanguageCode } from '../types/exam';
import type { StudyPlan, PlanDay, PlanItem } from '../types/plan';
import { addDaysISO, daysInclusive, todayISO } from './dateUtils';

const STRATEGY = 'weighted-syllabus-v1';
const PLAN_VERSION = 1;

const MIN_PER_STUDY_TOPIC = 45;
const MIN_PER_REVISION_TOPIC = 25;
const MIN_DAILY_CA = 15;
const FALLBACK_MOCK_MIN = 180;
const REVISION_TOPICS_PER_DAY = 3;

export interface GeneratePlanOptions {
  /** ISO YYYY-MM-DD; defaults to today. */
  startDate?: string;
  /** ISO YYYY-MM-DD. */
  examDate: string;
  language: LanguageCode;
  /** ISO datetime for `generatedAt` (injectable for deterministic tests). */
  now?: string;
}

/** Topics ordered by paper → subject → topic order, the natural study sequence. */
function orderedTopics(exam: ExamTaxonomy): ExamTopic[] {
  const paperIndex = new Map(exam.pattern.papers.map((p, i) => [p.id, i]));
  const subjectIndex = new Map(exam.subjects.map((s, i) => [s.id, i]));
  const subjectPaper = new Map(exam.subjects.map((s) => [s.id, s.paperId]));

  return [...exam.topics].sort((a, b) => {
    const pa = paperIndex.get(subjectPaper.get(a.subjectId) ?? '') ?? 0;
    const pb = paperIndex.get(subjectPaper.get(b.subjectId) ?? '') ?? 0;
    if (pa !== pb) return pa - pb;
    const sa = subjectIndex.get(a.subjectId) ?? 0;
    const sb = subjectIndex.get(b.subjectId) ?? 0;
    if (sa !== sb) return sa - sb;
    return a.order - b.order;
  });
}

/**
 * Deterministic, syllabus-weighted study plan sized to the gap between start and exam date.
 * Structure: a study phase (topics distributed in syllabus order, weekly checkpoint mocks)
 * followed by a ~15% revision tail that alternates high-importance revision with full mocks,
 * plus a daily current-affairs habit. Re-runs cleanly when weak areas emerge (M6).
 */
export function generatePlan(exam: ExamTaxonomy, opts: GeneratePlanOptions): StudyPlan {
  const startDate = opts.startDate ?? todayISO();
  const examDate = opts.examDate;
  const totalDays = daysInclusive(startDate, examDate);
  const topics = orderedTopics(exam);
  const mockMinutes =
    exam.pattern.totalDurationMinutes > 0 ? exam.pattern.totalDurationMinutes : FALLBACK_MOCK_MIN;

  // Reserve a revision/mock tail (~15% of the horizon), bounded.
  const revisionTail = totalDays >= 4 ? Math.min(10, Math.max(1, Math.round(totalDays * 0.15))) : 0;
  const studyDayCount = Math.max(1, totalDays - revisionTail);
  const perStudyDay = Math.max(1, Math.ceil(topics.length / studyDayCount));

  const highImportance = topics.filter((t) => t.importance === 'high');
  const revisionPool = highImportance.length > 0 ? highImportance : topics;

  const days: PlanDay[] = [];
  let topicCursor = 0;
  let revisionCursor = 0;

  for (let d = 0; d < totalDays; d++) {
    const date = addDaysISO(startDate, d);
    const items: PlanItem[] = [];
    let focusSubjectId: string | null = null;

    // Daily current-affairs habit (ties into the M4 daily loop).
    items.push({
      topicId: null,
      subjectId: null,
      kind: 'current-affairs',
      title: 'Daily current affairs: digest + 10 MCQs',
      estimatedMinutes: MIN_DAILY_CA,
    });

    const inRevisionPhase = d >= studyDayCount;
    if (inRevisionPhase) {
      const tailIndex = d - studyDayCount;
      const isLastDay = d === totalDays - 1;
      if (isLastDay || tailIndex % 2 === 1) {
        items.push({
          topicId: null,
          subjectId: null,
          kind: 'mock',
          title: `Full-length mock — ${exam.shortName}`,
          estimatedMinutes: mockMinutes,
        });
      } else {
        for (let k = 0; k < REVISION_TOPICS_PER_DAY && revisionPool.length > 0; k++) {
          const t = revisionPool[revisionCursor % revisionPool.length];
          revisionCursor++;
          items.push({
            topicId: t.id,
            subjectId: t.subjectId,
            kind: 'revision',
            title: `Revise: ${t.name}`,
            estimatedMinutes: MIN_PER_REVISION_TOPIC,
          });
        }
        focusSubjectId = items.find((i) => i.subjectId !== null)?.subjectId ?? null;
      }
    } else {
      const dayTopics = topics.slice(topicCursor, topicCursor + perStudyDay);
      topicCursor += perStudyDay;
      for (const t of dayTopics) {
        items.push({
          topicId: t.id,
          subjectId: t.subjectId,
          kind: 'study',
          title: `Study: ${t.name}`,
          estimatedMinutes: MIN_PER_STUDY_TOPIC,
        });
      }
      focusSubjectId = dayTopics.length > 0 ? dayTopics[0].subjectId : null;

      // Weekly checkpoint mock during the study phase.
      if (d > 0 && (d + 1) % 7 === 0) {
        items.push({
          topicId: null,
          subjectId: null,
          kind: 'mock',
          title: `Checkpoint mock — ${exam.shortName}`,
          estimatedMinutes: mockMinutes,
        });
      }
    }

    days.push({ dayIndex: d, date, items, focusSubjectId });
  }

  // Any topics left over from rounding → append to the last study day so nothing is dropped.
  if (topicCursor < topics.length) {
    const lastStudyDay = days[Math.max(0, Math.min(studyDayCount, totalDays) - 1)];
    for (const t of topics.slice(topicCursor)) {
      lastStudyDay.items.push({
        topicId: t.id,
        subjectId: t.subjectId,
        kind: 'study',
        title: `Study: ${t.name}`,
        estimatedMinutes: MIN_PER_STUDY_TOPIC,
      });
    }
  }

  return {
    examId: exam.id,
    language: opts.language,
    startDate,
    examDate,
    totalDays,
    days,
    generatedAt: opts.now ?? new Date().toISOString(),
    version: PLAN_VERSION,
    strategy: STRATEGY,
  };
}
