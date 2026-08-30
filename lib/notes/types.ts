/** Database row shapes. These mirror supabase/schemas/*.sql — they are not
 *  the view types the components consume, which live in lib/mock/types.ts. */

import type { SpeakerToken } from "@/lib/mock/types";

export type ChunkType =
  | "summary"
  | "takeaway"
  | "action_item"
  | "transcript_segment"
  | "imported_doc";

export type ProcessingStatus = "local" | "uploading" | "analyzing" | "completed";

export interface NoteRow {
  id: string;
  user_id: string;
  title: string | null;
  processing_status: ProcessingStatus;
  raw_transcript: string | null;
  diarization_enabled: boolean;
  audio_duration_seconds: number | null;
  audio_storage_path: string | null;
  created_at: string;
  updated_at: string;
}

/** metadata jsonb. Every field is optional because one column serves five
 *  chunk types — a transcript segment has no `due`, an action item has no
 *  `runs`. */
export interface ChunkMetadata {
  seq?: number;
  ts_start?: string;
  ts_end?: string;
  source_url?: string;
  segment_id?: number;
  /** Takeaway ordinal, rendered as "01", "02", "03". */
  n?: string;
  /** Action item only. */
  owner?: string;
  due?: string;
  /** Transcript segment only. token is a token name, never a colour. */
  speaker?: { name: string; initials: string; token: SpeakerToken };
  /** Summary only: the CiteRun[] split, so citation chips sit inline. */
  runs?: { text: string; cite?: { time: string; segmentId: number } }[];
}

export interface ChunkRow {
  id: string;
  note_id: string;
  user_id: string;
  chunk_type: ChunkType;
  content: string;
  embedding: number[] | null;
  metadata: ChunkMetadata;
  created_at: string;
}
