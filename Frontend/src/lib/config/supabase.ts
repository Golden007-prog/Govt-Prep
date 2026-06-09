import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ENV } from './env';

/**
 * Lazily-created Supabase client (hosted backend: Auth + Postgres + Edge Functions).
 * Returns null when no project is configured, so the app cleanly falls back to the
 * local-first (Dexie/BYOK) path during local development and on the free tier.
 */
let client: SupabaseClient | null = null;

export function supabaseEnabled(): boolean {
  return ENV.supabaseUrl.length > 0 && ENV.supabaseAnonKey.length > 0;
}

export function getSupabase(): SupabaseClient | null {
  if (!supabaseEnabled()) return null;
  if (!client) {
    client = createClient(ENV.supabaseUrl, ENV.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}
