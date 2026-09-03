/** Database row shapes. These mirror supabase/schemas/*.sql — they are not
 *  the view types the components consume, which live in lib/notes/view-types.ts. */

import type {
  NotegenStatus,
  PersonaDepth,
  ProcessingStatus,
  SpeakerToken,
} from "@/lib/notes/view-types";

/** Declared in view-types.ts so client components can import it without
 *  pulling in the row shapes. Re-exported here because this is where the rest
 *  of the notes table's shape lives. */
export type { ProcessingStatus, NotegenStatus } from "@/lib/notes/view-types";

export type ChunkType =
  | "summary"
  | "takeaway"
  | "action_item"
  | "transcript_segment"
  | "imported_doc";

export interface NoteRow {
  id: string;
  user_id: string;
  title: string | null;
  processing_status: ProcessingStatus;
  /** Structured note generation's queue, independent of the column above.
   *  Null until a transcript exists. See supabase/schemas/notes.sql. */
  notegen_status: NotegenStatus | null;
  /** Which lens this note generates under. Null means the default persona —
   *  the same meaning the column carries on note_chunks. Every note written
   *  before 2026-09-02 is null and there is no backfill. Composite FK to
   *  personas (id, user_id); see supabase/schemas/personas.sql. */
  persona_id: string | null;
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
  /** The same instants as ts_start / ts_end, unrounded, in seconds. The string
   *  pair above is a DISPLAY value — note-view-model.ts renders it verbatim —
   *  so it cannot also carry precision. Written by the transcription pipeline;
   *  nothing reads these yet. */
  ts_start_seconds?: number;
  ts_end_seconds?: number;
  source_url?: string;
  segment_id?: number;
  /** Embedding retry bookkeeping, written by lib/rag/*. The chunk row's own
   *  `embedding IS NULL` is the queue; this is only the give-up counter, so a
   *  chunk that can never be embedded stops being retried forever. Merged into
   *  this object, never written over it — a transcript_segment's speaker and
   *  timestamps live here too. */
  embed_attempts?: number;
  /** The last failure reason, truncated. There is no error column at this
   *  scale and the Vercel log rotates; this is what a later operator reads. */
  embed_error?: string;
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
  /** Null means the chunk belongs to the default persona. */
  persona_id: string | null;
  content: string;
  embedding: number[] | null;
  metadata: ChunkMetadata;
  created_at: string;
}

/** A personas row. `slug` is what the view model exposes as Persona.id —
 *  the uuid is per-user and would not survive a reseed. */
export interface PersonaRow {
  id: string;
  user_id: string;
  slug: string;
  name: string;
  sub: string;
  depth: PersonaDepth;
  quick_actions: string[];
  sort_order: number;
  created_at: string;
  updated_at: string;
}
