import Dexie, { type Table } from 'dexie';
import type { UserProfile } from '../types/user';
import type { StudyPlan } from '../types/plan';
import type { LanguageCode } from '../types/exam';
import type { ContentType, CurrentAffairsItem, QuizQuestion } from '../types/content';
import type { MockAttemptRecord } from '../types/mock';

export interface AppSetting {
  key: string;
  value: unknown;
}

export interface TopicProgress {
  id: string; // e.g. "sys-db-1"
  subject: string; // subjectId
  topicName: string;
  mastery: number; // 0 to 100
  lastStudiedAt?: number; // timestamp
  nextDueAt?: number; // timestamp for FSRS
  status: 'locked' | 'available' | 'started' | 'completed';
}

export interface IngestedVideo {
  videoId: string;
  title: string;
  channelName: string;
  thumbnailUrl?: string;
  duration?: string;
  summary: string;
  quiz: {
    questions: Array<{
      id: string;
      type: 'mcq' | 'short';
      question: string;
      options?: string[]; // for MCQ
      correctAnswer: string; // index for MCQ, or reference answer for short
      explanation: string;
    }>;
  };
  homework: {
    description: string;
    problems: Array<{
      id: string;
      question: string;
      referenceSolution: string;
    }>;
  };
  flashcards: Array<{
    id: string;
    front: string;
    back: string;
  }>;
  ingestedAt: number;
}

export interface Flashcard {
  id?: number; // Auto-incremented primary key
  cardId: string; // UUID or string generated during extraction
  videoId: string; // Links to IngestedVideo ('' when generated from a topic)
  topicId: string; // Links to TopicProgress
  front: string;
  back: string;
  // FSRS scheduling parameters (fields mapped from Card in ts-fsrs)
  due: Date;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: number; // 0=New, 1=Learning, 2=Review, 3=Relearning
  last_review?: Date;
}

export interface ActivityLog {
  id?: number;
  date: string; // YYYY-MM-DD
  xpEarned: number;
  actions: string[]; // e.g. ['quiz_completed', 'card_reviewed']
}

/** Cached AI-generated artifact. id = `${examFamily}|${topicId}|${type}|${language}`. */
export interface CachedContent {
  id: string;
  examFamily: string;
  topicId: string;
  type: ContentType | 'homework-md' | 'mnemonics';
  language: LanguageCode;
  /** The artifact (Notes / Quiz / Flashcard[] / markdown string / …) as stored JSON. */
  content: unknown;
  createdAt: number;
}

/** One day's current-affairs digest. id = `${date}|${examFamily}|${language}`. */
export interface CaDigest {
  id: string;
  date: string; // YYYY-MM-DD
  examFamily: string;
  language: LanguageCode;
  items: CurrentAffairsItem[];
  quiz: QuizQuestion[];
  createdAt: number;
}

/** Pomodoro / study focus session. */
export interface StudySession {
  id?: number;
  date: string; // YYYY-MM-DD
  kind: 'pomodoro' | 'study' | 'mock' | 'review';
  minutes: number;
  topicId?: string;
  startedAt: number;
}

/** Unlocked achievement (catalog lives in lib/types/progress.ts). */
export interface UnlockedAchievement {
  id: string; // catalog slug
  unlockedAt: number;
}

export class GovPrepDatabase extends Dexie {
  settings!: Table<AppSetting, string>;
  topics!: Table<TopicProgress, string>;
  ingestedVideos!: Table<IngestedVideo, string>;
  flashcards!: Table<Flashcard, number>;
  activityLogs!: Table<ActivityLog, number>;
  // M0/M1: onboarding profile + generated study plans (local-first mirror of the hosted schema).
  profiles!: Table<UserProfile, string>;
  plans!: Table<StudyPlan, string>;
  // v3 feature build:
  contentCache!: Table<CachedContent, string>;
  caDigests!: Table<CaDigest, string>;
  mockAttempts!: Table<MockAttemptRecord, number>;
  studySessions!: Table<StudySession, number>;
  achievements!: Table<UnlockedAchievement, string>;

  constructor() {
    super('GovPrepDatabase');
    this.version(1).stores({
      settings: 'key',
      topics: 'id, subject, status, nextDueAt',
      ingestedVideos: 'videoId, ingestedAt',
      flashcards: '++id, cardId, videoId, topicId, due, state',
      activityLogs: '++id, date',
    });
    // v2 adds the onboarding tables; unchanged tables carry over automatically (Dexie merges
    // version specs additively — a table is only dropped by declaring it null).
    this.version(2).stores({
      profiles: 'id, targetExamId',
      plans: 'examId',
    });
    // v3: feature build — content cache, CA digests, mocks, sessions, achievements.
    this.version(3).stores({
      contentCache: 'id, topicId, type',
      caDigests: 'id, date',
      mockAttempts: '++id, examId, startedAt, submittedAt',
      studySessions: '++id, date, kind',
      achievements: 'id',
    });
  }
}

export const db = new GovPrepDatabase();
