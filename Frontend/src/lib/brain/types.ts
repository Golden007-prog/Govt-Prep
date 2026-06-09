import type { LanguageCode } from '../types/exam';
import type { Notes, Quiz, Flashcard, GradeResult, QuizQuestion } from '../types/content';

export interface VideoRef {
  videoId: string;
  url: string;
  title: string;
  channel: string;
}

export interface BrainContext {
  language: LanguageCode;
  topicId: string;
  topicName: string;
  syllabusText: string;
}

/** One lean, batched call returns notes + quiz + cards together (spec §4 / AGENTS.md). */
export interface StudyBundle {
  notes: Notes;
  quiz: Quiz;
  cards: Flashcard[];
}

/**
 * The AI "brain" — dependency inversion: the app depends only on this interface.
 * Hybrid impls (built in M2+): BrowserAnthropicBrain (BYOK, hosted free tier),
 * LocalClaudeBrain (local backend → `claude -p`), and a Supabase Edge Function brain
 * (operator keys, hosted paid tier). Swapping the impl changes nothing else.
 */
export interface Brain {
  readonly id: string;
  makeStudyBundle(transcriptOrSummary: string, ctx: BrainContext): Promise<StudyBundle>;
  grade(question: QuizQuestion, userAnswer: string, ctx: BrainContext): Promise<GradeResult>;
  makeHomework(notes: Notes, ctx: BrainContext): Promise<string>;
}
