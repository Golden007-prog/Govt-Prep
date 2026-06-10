import { getSupabase } from '../config/supabase';
import type { LanguageCode } from '../types/exam';

/**
 * Shared content cache on Supabase (`public.content_cache`): expensive AI artifacts are
 * generated ONCE per (exam-family, topic, type, language) and shared across all users.
 * Reads are anonymous (RLS world-readable); writes work for any signed-in or anon client
 * only if a policy allows — failures are swallowed (the local Dexie cache is authoritative).
 */

export interface SharedCacheKey {
  examFamily: string;
  topicId: string;
  type: string;
  language: LanguageCode;
}

export async function sharedCacheGet<T>(key: SharedCacheKey): Promise<T | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('content_cache')
      .select('content')
      .eq('exam_family', key.examFamily)
      .eq('topic_id', key.topicId)
      .eq('type', key.type)
      .eq('language', key.language)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return data.content as T;
  } catch {
    return null;
  }
}

export async function sharedCachePut(key: SharedCacheKey, content: unknown): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    await supabase.from('content_cache').insert({
      exam_family: key.examFamily,
      topic_id: key.topicId,
      type: key.type,
      language: key.language,
      version: 1,
      content,
    });
  } catch {
    // Shared cache is best-effort; Dexie remains the source of truth locally.
  }
}
