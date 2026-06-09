import type { Session } from '@supabase/supabase-js';
import { getSupabase } from '../config/supabase';
import { ENV } from '../config/env';

export interface AuthUser {
  id: string;
  email: string | null;
  displayName: string | null;
}

/** Auth is available only when a Supabase project is configured. */
export function authAvailable(): boolean {
  return getSupabase() !== null;
}

function toAuthUser(session: Session): AuthUser {
  const u = session.user;
  const name =
    (typeof u.user_metadata?.['user_name'] === 'string' && u.user_metadata['user_name']) ||
    (typeof u.user_metadata?.['full_name'] === 'string' && u.user_metadata['full_name']) ||
    null;
  return { id: u.id, email: u.email ?? null, displayName: name || null };
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session ? toAuthUser(data.session) : null;
}

/** Start GitHub OAuth (hosted mode). Redirects back to the app base path. */
export async function signInWithGitHub(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase is not configured — set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.');
  const redirectTo = window.location.origin + ENV.basePath;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.auth.signOut();
}

/** Subscribe to auth changes. Returns an unsubscribe fn. No-op when Supabase is absent. */
export function onAuthChange(cb: (user: AuthUser | null) => void): () => void {
  const supabase = getSupabase();
  if (!supabase) {
    cb(null);
    return () => {};
  }
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session ? toAuthUser(session) : null);
  });
  return () => data.subscription.unsubscribe();
}
