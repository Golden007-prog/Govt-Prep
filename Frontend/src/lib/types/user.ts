import type { LanguageCode } from './exam';

export type Tier = 'free' | 'paid';

/** Where the AI "brain" runs for this session (hybrid architecture). */
export type BrainProvider = 'local-claude' | 'browser-anthropic' | 'supabase-operator';

/**
 * A user profile. In local/anonymous mode this is a single on-device record
 * (id = 'local-user'); in hosted mode id = the Supabase auth uid.
 */
export interface UserProfile {
  id: string;
  email: string | null;
  displayName: string | null;
  targetExamId: string | null;
  /** ISO YYYY-MM-DD. */
  examDate: string | null;
  languagePref: LanguageCode;
  tier: Tier;
  /** ISO datetime. */
  createdAt: string;
  /** ISO datetime. */
  updatedAt: string;
}

export const LOCAL_USER_ID = 'local-user';
