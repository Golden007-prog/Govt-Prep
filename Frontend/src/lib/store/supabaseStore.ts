import type { SupabaseClient } from '@supabase/supabase-js';
import type { Store, StoreKind } from './types';
import type { UserProfile, Tier } from '../types/user';
import type { StudyPlan } from '../types/plan';
import type { LanguageCode } from '../types/exam';

interface UserRow {
  id: string;
  email: string | null;
  display_name: string | null;
  target_exam_id: string | null;
  exam_date: string | null;
  language_pref: string;
  tier: string;
  created_at: string;
  updated_at: string;
}

function rowToProfile(r: UserRow): UserProfile {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    targetExamId: r.target_exam_id,
    examDate: r.exam_date,
    languagePref: (r.language_pref === 'hi' ? 'hi' : 'en') satisfies LanguageCode,
    tier: (r.tier === 'paid' ? 'paid' : 'free') satisfies Tier,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function profileToRow(p: UserProfile): UserRow {
  return {
    id: p.id,
    email: p.email,
    display_name: p.displayName,
    target_exam_id: p.targetExamId,
    exam_date: p.examDate,
    language_pref: p.languagePref,
    tier: p.tier,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

/**
 * Hosted store backed by Supabase Postgres. Row-Level Security restricts every row to
 * the authenticated user (see supabase/migrations). Activated only when a Supabase
 * project is configured AND the user is signed in; otherwise the app uses DexieStore.
 */
export class SupabaseStore implements Store {
  readonly kind: StoreKind = 'supabase';
  private readonly client: SupabaseClient;
  private readonly userId: string;

  constructor(client: SupabaseClient, userId: string) {
    this.client = client;
    this.userId = userId;
  }

  async getProfile(): Promise<UserProfile | null> {
    const { data, error } = await this.client
      .from('users')
      .select('*')
      .eq('id', this.userId)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToProfile(data as UserRow) : null;
  }

  async saveProfile(profile: UserProfile): Promise<void> {
    const row = profileToRow({ ...profile, id: this.userId });
    const { error } = await this.client.from('users').upsert(row, { onConflict: 'id' });
    if (error) throw error;
  }

  async getPlan(examId: string): Promise<StudyPlan | null> {
    const { data, error } = await this.client
      .from('study_plans')
      .select('plan')
      .eq('user_id', this.userId)
      .eq('exam_id', examId)
      .maybeSingle();
    if (error) throw error;
    return data ? (data.plan as StudyPlan) : null;
  }

  async savePlan(plan: StudyPlan): Promise<void> {
    const { error } = await this.client.from('study_plans').upsert(
      {
        user_id: this.userId,
        exam_id: plan.examId,
        plan,
        version: plan.version,
        generated_at: plan.generatedAt,
      },
      { onConflict: 'user_id,exam_id' },
    );
    if (error) throw error;
  }

  async getActivePlan(): Promise<StudyPlan | null> {
    const profile = await this.getProfile();
    if (!profile?.targetExamId) return null;
    return this.getPlan(profile.targetExamId);
  }
}
