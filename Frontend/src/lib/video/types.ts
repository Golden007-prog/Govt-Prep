import type { VideoRef } from '../brain/types';

export type IngestSource = 'transcript';

export interface IngestResult {
  videoId: string;
  transcriptText: string;
  source: IngestSource;
}

/**
 * Video ingestion — dependency inversion. Claude-only architecture (v3):
 *   TranscriptIngestor (local: backend fetches transcript — cheap, no CORS) → Claude summarizes.
 *   Hosted mode does NOT ingest videos (no transcript access from the browser — CORS);
 *   lectures are linked out to YouTube and study content is generated from the syllabus.
 * Never fetch YouTube transcripts from the browser (CORS) — AGENTS.md hard constraint.
 */
export interface VideoIngestor {
  readonly id: string;
  ingest(video: VideoRef): Promise<IngestResult>;
}
