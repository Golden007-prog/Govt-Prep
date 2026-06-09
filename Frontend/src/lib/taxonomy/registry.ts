import type { ExamTaxonomy, ExamSubject, ExamTopic, ExamPaper } from '../types/exam';
import { EXAMS } from '../../data/exams';
import channelsData from '../../data/channels.json';

export interface ChannelWhitelistEntry {
  name: string;
  handle: string;
  trust: number;
  subjectIds: string[];
}

const CHANNELS = (channelsData.channels ?? []) as ChannelWhitelistEntry[];

export function listExams(): ExamTaxonomy[] {
  return EXAMS;
}

export function getExam(examId: string): ExamTaxonomy | null {
  return EXAMS.find((e) => e.id === examId) ?? null;
}

export function getExamOrThrow(examId: string): ExamTaxonomy {
  const exam = getExam(examId);
  if (!exam) throw new Error(`[taxonomy] unknown exam "${examId}"`);
  return exam;
}

export function getSubject(exam: ExamTaxonomy, subjectId: string): ExamSubject | null {
  return exam.subjects.find((s) => s.id === subjectId) ?? null;
}

export function getTopic(exam: ExamTaxonomy, topicId: string): ExamTopic | null {
  return exam.topics.find((t) => t.id === topicId) ?? null;
}

export function getPaper(exam: ExamTaxonomy, paperId: string): ExamPaper | null {
  return exam.pattern.papers.find((p) => p.id === paperId) ?? null;
}

export function subjectsForPaper(exam: ExamTaxonomy, paperId: string): ExamSubject[] {
  return exam.subjects.filter((s) => s.paperId === paperId);
}

/** Topics of a subject, ordered as in the syllabus. */
export function topicsForSubject(exam: ExamTaxonomy, subjectId: string): ExamTopic[] {
  return exam.topics
    .filter((t) => t.subjectId === subjectId)
    .sort((a, b) => a.order - b.order);
}

export function getPaperForSubject(exam: ExamTaxonomy, subjectId: string): ExamPaper | null {
  const subject = getSubject(exam, subjectId);
  if (!subject) return null;
  return getPaper(exam, subject.paperId);
}

/** Whitelisted lecture channels good for a subject, best-trusted first (spec §7b ranking). */
export function channelsForSubject(subjectId: string): ChannelWhitelistEntry[] {
  return CHANNELS
    .filter((c) => c.subjectIds.includes(subjectId))
    .sort((a, b) => b.trust - a.trust);
}

export function allChannels(): ChannelWhitelistEntry[] {
  return CHANNELS;
}
