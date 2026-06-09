import type { Store } from './types';
import { DexieStore } from './dexieStore';
import { SupabaseStore } from './supabaseStore';
import { getSupabase } from '../config/supabase';

export interface HostedSession {
  userId: string;
}

export interface StoreContext {
  /** Present only when a Supabase project is configured AND the user is signed in. */
  hostedSession: HostedSession | null;
}

/**
 * Factory: hosted Supabase store when authenticated against a configured project,
 * else the local-first Dexie store. The rest of the app just calls `store.*`.
 */
export function getStore(ctx: StoreContext): Store {
  const supabase = getSupabase();
  if (supabase && ctx.hostedSession) {
    return new SupabaseStore(supabase, ctx.hostedSession.userId);
  }
  return new DexieStore();
}

export type { Store, StoreKind } from './types';
