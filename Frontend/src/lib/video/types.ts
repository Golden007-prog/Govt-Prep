import type { VideoRef } from '../brain/types';

export type IngestSource = 'transcript' | 'gemini-url';

export interface IngestResult {
  videoId: string;
  transcriptText: string;
  source: IngestSource;
}

/**
 * Video ingestion — dependency inversion. Hybrid impls (M3):
 *   TranscriptIngestor  (local: backend fetches transcript — cheap, no CORS)
 *   GeminiUrlIngestor   (hosted: Gemini-by-URL, ~300 tok/s — results MUST be cached).
 * Never fetch YouTube transcripts from the browser (CORS) — AGENTS.md hard constraint.
 */
export interface VideoIngestor {
  readonly id: string;
  ingest(video: VideoRef): Promise<IngestResult>;
}
