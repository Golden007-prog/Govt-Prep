import type { Store, StoreKind } from './types';
import type { UserProfile } from '../types/user';
import { LOCAL_USER_ID } from '../types/user';
import type { StudyPlan } from '../types/plan';
import { db } from './db';

/** Local-first store backed by IndexedDB (Dexie). Single on-device profile. */
export class DexieStore implements Store {
  readonly kind: StoreKind = 'dexie';

  async getProfile(): Promise<UserProfile | null> {
    return (await db.profiles.get(LOCAL_USER_ID)) ?? null;
  }

  async saveProfile(profile: UserProfile): Promise<void> {
    await db.profiles.put({ ...profile, id: LOCAL_USER_ID });
  }

  async getPlan(examId: string): Promise<StudyPlan | null> {
    return (await db.plans.get(examId)) ?? null;
  }

  async savePlan(plan: StudyPlan): Promise<void> {
    await db.plans.put(plan);
  }

  async getActivePlan(): Promise<StudyPlan | null> {
    const profile = await this.getProfile();
    if (!profile?.targetExamId) return null;
    return this.getPlan(profile.targetExamId);
  }
}
