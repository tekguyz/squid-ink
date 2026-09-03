import type { ChunkMetadata } from "@/lib/notes/types";
import type { DocumentEmbedder } from "@/lib/rag/voyage-client";

/** All the branching, and none of the I/O.
 *
 *  `note_chunks.embedding IS NULL` IS THE QUEUE. Same philosophy as
 *  processing_status and notegen_status, at a different grain: embeddings are
 *  per CHUNK, not per note, so the queue state lives on the chunk row itself
 *  and there is no new status column and no job table. A column that is null
 *  until it is filled already says everything a 'pending' string would.
 *
 *  THIS FILE OWNS note_chunks.embedding AND NOTHING ELSE.
 *  lib/transcription/sweep.ts owns processing_status and lib/notegen/sweep.ts
 *  owns notegen_status. The cap/deadline shape below is the same SHAPE as
 *  theirs, deliberately reimplemented rather than reached across for — editing
 *  either of those files to handle a column it does not own is exactly the
 *  scope violation this project's conventions call out. */

/** Three individual failures and the chunk is left alone permanently.
 *
 *  Counted in note_chunks.metadata, not in a new column: the column exists,
 *  is not null, defaults to '{}', and every consumer already reads it as a
 *  bag. A dedicated integer column would be a schema change carrying one
 *  number that only this pipeline reads. */
export const MAX_EMBED_ATTEMPTS = 3;

/** NOTES per cron run, not chunks. A run is capped by notes because a note is
 *  the batching unit — its chunks go to Voyage in one request.
 *
 *  Ten is deliberately conservative. The Voyage call itself is fast (sub-second
 *  for a note's worth of text, against a 2,000 RPM / 8,000,000 TPM tier-1
 *  limit we cannot approach at this volume). What actually costs wall-clock is
 *  the WRITE-BACK: one guarded UPDATE per chunk, because PostgREST cannot set a
 *  different value per row in one statement. A long note is ~100 chunks, so
 *  ten notes is up to ~1,000 round trips. The 300 s Hobby ceiling is now shared
 *  THREE ways, and this phase runs last. */
export const MAX_EMBED_NOTES_PER_RUN = 10;

/** How many pending chunks one sweep pulls before grouping them into notes.
 *  Wide enough that MAX_EMBED_NOTES_PER_RUN notes are actually reachable even
 *  when the oldest note is a long one. */
export const EMBED_CHUNK_WINDOW = 500;

/** A chunk waiting for its vector. Deliberately these columns and nothing more
 *  — the embedding itself is never read back, only written. */
export interface PendingChunk {
  id: string;
  note_id: string;
  user_id: string;
  content: string;
  metadata: ChunkMetadata;
}

export function attemptsIn(metadata: ChunkMetadata): number {
  const value = metadata?.embed_attempts;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** MERGE, NEVER OVERWRITE.
 *
 *  A transcript_segment chunk already carries speaker, ts_start, ts_end,
 *  ts_start_seconds, ts_end_seconds and seq in this same object, and the
 *  transcript pane renders every one of them. Replacing the object would empty
 *  the pane for a note that transcribed perfectly well.
 *
 *  PostgREST cannot send `metadata || jsonb_build_object(...)` — it has no way
 *  to express a SQL expression in an update. So the merge happens here, on the
 *  object the listing query already returned, and the guarded UPDATE writes
 *  the merged whole. Same result, and a unit test can hold it to it. */
export function withEmbedAttempt(
  metadata: ChunkMetadata,
  attempts: number,
  reason: string,
): ChunkMetadata {
  return {
    ...metadata,
    embed_attempts: Math.min(attempts, MAX_EMBED_ATTEMPTS),
    embed_error: reason.slice(0, 200),
  };
}

/** Every side effect, injected — which is what lets the batch fallback, the
 *  attempt cap and the contended write be tested with no database and no
 *  network. */
export interface EmbeddingPorts {
  now(): number;
  log(message: string): void;
  /** embedding IS NULL and under the attempt cap, oldest first, ACROSS EVERY
   *  USER. No user_id filter: this runs as service_role and crossing tenants
   *  is the entire job. */
  listPending(limit: number): Promise<PendingChunk[]>;
  /** The same predicate, narrowed to one note. The inline path's entry point. */
  listPendingForNote(noteId: string, limit: number): Promise<PendingChunk[]>;
  /** THE guarded write: UPDATE ... WHERE id = $1 AND embedding IS NULL.
   *  False means somebody else got there first — not an error. */
  writeEmbedding(chunkId: string, vector: number[]): Promise<boolean>;
  /** Writes the merged metadata back, guarded on embedding IS NULL so a chunk
   *  that succeeded elsewhere is never marked as having failed here. */
  recordAttempt(chunkId: string, metadata: ChunkMetadata): Promise<void>;
  embed: DocumentEmbedder;
}

/** The only observability this pipeline has. There is no error column, so the
 *  counters have to distinguish CAUSES rather than tally rows — a rate limit
 *  and a poison chunk are very different situations. */
export interface EmbedReport {
  embedded: number;
  /** Whitespace-only content. Terminal on sight, never a Voyage call. */
  blank: number;
  /** Reached MAX_EMBED_ATTEMPTS on this pass. Left null permanently. */
  exhausted: number;
  /** Failed transiently (429/5xx/network). Counter untouched, still eligible. */
  retryable: number;
  /** Another worker wrote the vector between our listing and our UPDATE. */
  contended: number;
}

export function emptyReport(): EmbedReport {
  return { embedded: 0, blank: 0, exhausted: 0, retryable: 0, contended: 0 };
}
