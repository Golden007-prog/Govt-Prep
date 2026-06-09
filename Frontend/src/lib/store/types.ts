import type { UserProfile } from '../types/user';
import type { StudyPlan } from '../types/plan';

export type StoreKind = 'dexie' | 'supabase';

/**
 * Persistence abstraction. Two impls (hybrid):
 *   DexieStore    — on-device IndexedDB (local-first / free tier / offline).
 *   SupabaseStore — hosted Postgres (multi-user, synced) once authenticated.
 * The app depends only on this interface, so switching backends is a factory swap.
 */
export interface Store {
  readonly kind: StoreKind;
  getProfile(): Promise<UserProfile | null>;
  saveProfile(profile: UserProfile): Promise<void>;
  getPlan(examId: string): Promise<StudyPlan | null>;
  savePlan(plan: StudyPlan): Promise<void>;
  /** The plan for the profile's current targetExamId, if any. */
  getActivePlan(): Promise<StudyPlan | null>;
}
