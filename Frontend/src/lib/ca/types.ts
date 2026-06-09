import type { LanguageCode } from '../types/exam';
import type { CurrentAffairsItem } from '../types/content';

export interface RawNewsItem {
  title: string;
  url: string;
  /** ISO datetime. */
  publishedAt: string;
  sourceName: string;
  rawText?: string;
}

/**
 * Current-affairs ingestion (spec §7c) — dependency inversion. The scheduled pipeline
 * (Supabase pg_cron / Edge Function, M4) aggregates primary sources (PIB, RBI, ministries,
 * RSS) and summarizes each item IN ITS OWN WORDS + source link — never rehosting a digest.
 * Generated once per (exam-family, date) and cached for all users of that exam.
 */
export interface CurrentAffairsIngestor {
  readonly id: string;
  summarize(items: RawNewsItem[], date: string, language: LanguageCode): Promise<CurrentAffairsItem[]>;
}
