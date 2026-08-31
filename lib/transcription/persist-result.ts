import type { ChunkMetadata } from "@/lib/notes/types";
import {
  formatTimestamp,
  speakerFor,
  speakerOrdinals,
  type TranscriptionResult,
} from "@/lib/transcription/transcript";

/** Turns a TranscriptionResult into rows, and writes them in the one order
 *  that is safe to crash in the middle of.
 *
 *  Chunks are written BEFORE the 'completed' flip. If insertion dies partway,
 *  the row stays at 'analyzing' and the staleness sweep marks it 'failed' an
 *  hour later. That existing safety net is the rollback — there is deliberately
 *  no transaction and no bespoke compensating write, because a second
 *  mechanism for the same failure is a second thing to get wrong.
 *
 *  The delete-then-insert is idempotency, not cleanup: a run that crashed after
 *  inserting would otherwise leave chunks that a later successful run would
 *  double. */

export interface NoteChunkInsert {
  note_id: string;
  user_id: string;
  chunk_type: "transcript_segment";
  /** A transcript belongs to no lens. Null reads as the default persona, which
   *  is exactly right — it is raw material, not an interpretation. */
  persona_id: null;
  content: string;
  /** RAG embeddings are a separate future track. Explicitly null, not omitted,
   *  so the intent is visible at the call site. */
  embedding: null;
  metadata: ChunkMetadata;
}

export interface TranscriptionStore {
  deleteTranscriptChunks(noteId: string): Promise<void>;
  insertChunks(rows: NoteChunkInsert[]): Promise<void>;
  /** Atomic: flips 'analyzing' -> 'completed' only if the row is still
   *  'analyzing'. False means another worker or the staleness sweep took it. */
  completeNote(args: {
    noteId: string;
    rawTranscript: string;
    diarized: boolean;
  }): Promise<boolean>;
  markFailed(noteId: string, reason: string): Promise<void>;
}

export function chunkRowsFor(args: {
  noteId: string;
  userId: string;
  result: TranscriptionResult;
}): NoteChunkInsert[] {
  const { noteId, userId, result } = args;

  const base = {
    note_id: noteId,
    user_id: userId,
    chunk_type: "transcript_segment" as const,
    persona_id: null,
    embedding: null,
  };

  if (result.segments.length === 0) {
    // A plain transcription returns output_text with no word annotations. One
    // untimed chunk keeps the transcript readable; zero chunks would render an
    // empty pane for a note that transcribed perfectly well.
    const content = result.rawTranscript.trim();
    if (!content) return [];

    return [
      {
        ...base,
        content,
        metadata: {
          seq: 0,
          ts_start: formatTimestamp(0),
          ts_end: formatTimestamp(0),
        },
      },
    ];
  }

  // Computed once across the whole transcript, not per segment: the ordinal is
  // a property of the recording, not of one row.
  const ordinals = speakerOrdinals(result.segments);

  return result.segments.map((segment, seq) => {
    const speaker = speakerFor(
      segment.speakerLabel ? ordinals.get(segment.speakerLabel) : null,
    );

    const metadata: ChunkMetadata = {
      seq,
      ts_start: formatTimestamp(segment.startSeconds),
      ts_end: formatTimestamp(segment.endSeconds),
      ts_start_seconds: segment.startSeconds,
      ts_end_seconds: segment.endSeconds,
    };

    // Omitted rather than null: note-view-model.ts substitutes its own Unknown
    // speaker for an absent one, and an explicit null would defeat that.
    if (speaker) metadata.speaker = speaker;

    return { ...base, content: segment.text, metadata };
  });
}

export async function persistTranscription(args: {
  store: TranscriptionStore;
  noteId: string;
  userId: string;
  result: TranscriptionResult;
}): Promise<void> {
  const { store, noteId, userId, result } = args;

  const rows = chunkRowsFor({ noteId, userId, result });

  await store.deleteTranscriptChunks(noteId);
  if (rows.length > 0) await store.insertChunks(rows);

  const completed = await store.completeNote({
    noteId,
    rawTranscript: result.rawTranscript,
    diarized: result.diarized,
  });

  if (!completed) {
    throw new Error(
      `note ${noteId} was no longer 'analyzing' when the transcript was ready`,
    );
  }
}
