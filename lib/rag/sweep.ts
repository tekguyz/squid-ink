import type { ChunkMetadata } from "@/lib/notes/types";
import { embedChunks } from "@/lib/rag/embed-note";
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
 *  It is a CHUNK cap, so it can bind before MAX_EMBED_NOTES_PER_RUN does: at
 *  the ~100-chunk long note quoted above, 500 chunks reaches five notes, not
 *  ten. That is deliberate and not a bug — the sweep is idempotent and runs
 *  daily, so the remainder is the next run's work, and a window wide enough to
 *  always reach ten long notes would be 1,000 write-backs in one phase of a
 *  shared 300 s budget. Short notes, which are the common case, reach the note
 *  cap first. */
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
 *  the merged whole. Same result for one writer, and a unit test can hold it
 *  to it.
 *
 *  Not identical for two. Because the merge is client-side, two triggers
 *  failing the same chunk at once each merge onto their own snapshot, so the
 *  counter can land at 1 where a SQL-side `||` would have reached 2. That
 *  errs toward MORE retries, never fewer, and never toward a lost field — the
 *  worst case is a poison chunk taking an extra sweep to exhaust. It is
 *  accepted, not overlooked. */
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

/** The run's own counters on top of the per-note ones. */
export interface EmbedSweepReport extends EmbedReport {
  /** Notes this run actually took up. */
  notes: number;
  /** Notes pushed to the next tick by the per-run cap or the shared budget. */
  deferred: number;
}

/** PHASE THREE of the cron run, and the BACKFILL.
 *
 *  It is both at once and deliberately so: "every chunk with no vector,
 *  oldest first, across every user" describes the rows the inline path missed
 *  AND every row that existed before this pipeline shipped. A separate
 *  one-shot backfill script would be a second implementation of the same
 *  query, and it would be dead code the day after it ran.
 *
 *  NO user_id FILTER. The standing rule in CLAUDE.md § Supabase → RLS rules is
 *  that queries never filter on user_id in application code, and this obeys
 *  it: the sweep runs as service_role, which bypasses RLS, and crossing every
 *  tenant's pending chunks is its entire purpose. This is NOT the
 *  persona-resolution exception, which filters precisely because an unfiltered
 *  single-row lookup could return the wrong account's row — there is no wrong
 *  account here.
 *
 *  deadlineAt is passed IN rather than computed, the same "one clock, N
 *  phases" rule note generation established against transcription's budget.
 *  The route reads one startedAt; transcription spends from it, note
 *  generation spends what is left, and this gets the remainder. A third
 *  independent budget would let one invocation run past the 300 s Hobby
 *  ceiling and be killed mid-write. This phase runs LAST, so on a busy run it
 *  is the one that defers — which is correct: a missing vector is invisible
 *  until retrieval ships, and tomorrow's sweep picks it up. */
export async function embeddingSweep(
  ports: EmbeddingPorts,
  options: { deadlineAt: number },
): Promise<EmbedSweepReport> {
  const report: EmbedSweepReport = { ...emptyReport(), notes: 0, deferred: 0 };

  const pending = await ports.listPending(EMBED_CHUNK_WINDOW);
  if (pending.length === 0) return report;

  // Grouped in listing order, which is oldest-chunk-first, so the note that
  // has waited longest is taken up first.
  const byNote = new Map<string, PendingChunk[]>();
  for (const chunk of pending) {
    const group = byNote.get(chunk.note_id);
    if (group) group.push(chunk);
    else byNote.set(chunk.note_id, [chunk]);
  }

  for (const [noteId, chunks] of byNote) {
    if (
      report.notes >= MAX_EMBED_NOTES_PER_RUN ||
      ports.now() > options.deadlineAt
    ) {
      report.deferred += 1;
      continue;
    }

    // The SAME unit the inline trigger calls. The chunks are already in hand
    // from the window above, so this takes embedChunks directly rather than
    // embedNoteChunks — one fewer round trip, identical behaviour.
    const noteReport = await embedChunks(ports, chunks);

    report.notes += 1;
    report.embedded += noteReport.embedded;
    report.blank += noteReport.blank;
    report.exhausted += noteReport.exhausted;
    report.retryable += noteReport.retryable;
    report.contended += noteReport.contended;

    if (noteReport.embedded > 0) {
      ports.log(`note ${noteId}: embedded ${noteReport.embedded} chunk(s).`);
    }
  }

  // Never let a cap read as completeness — but only say "deferred" when work
  // was genuinely pushed aside, so a healthy tick does not cry wolf.
  if (report.deferred > 0) {
    ports.log(
      `${report.deferred} note(s) deferred to the next tick — per-run cap ` +
        `${MAX_EMBED_NOTES_PER_RUN} note(s), shared budget ends at ` +
        `${options.deadlineAt}.`,
    );
  }

  return report;
}
