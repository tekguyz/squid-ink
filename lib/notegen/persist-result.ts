import type { ChunkMetadata } from "@/lib/notes/types";

/** Turns a GeneratedNote into rows, and writes them in the one order that is
 *  safe to crash in the middle of.
 *
 *  Chunks are written BEFORE the 'completed' flip, exactly as
 *  lib/transcription/persist-result.ts writes transcript segments before its
 *  own. If insertion dies partway, the row stays at 'generating' and the
 *  staleness sweep in lib/notegen/sweep.ts marks it 'failed' an hour later.
 *  THAT EXISTING NET IS THE ROLLBACK — there is deliberately no transaction
 *  and no bespoke compensating write, because a second mechanism for the same
 *  failure is a second thing to get wrong.
 *
 *  The delete-then-insert is idempotency, not cleanup: a run that crashed
 *  after inserting would otherwise leave chunks a later successful run
 *  doubles.
 *
 *  FIRST-RUN SIDE EFFECT, EXPECTED AND NOT A BUG. The claim guard matches
 *  every note already at processing_status = 'completed', which on first run
 *  includes the seeded note carrying hand-written takeaways at persona_id
 *  null. The delete below removes those and the insert replaces them with
 *  generated ones. Those seed rows were a fixture standing in for this
 *  pipeline; this is the pipeline arriving. */

export interface GeneratedNote {
  /** Null when the depth produced none — Brief asks for decisions and action
   *  items only. Not an empty string: absent and blank are different, and only
   *  one of them should reach the database as a row. */
  summary: string | null;
  takeaways: string[];
  actionItems: string[];
}

export type NotegenChunkType = "summary" | "takeaway" | "action_item";

export interface NotegenChunkInsert {
  note_id: string;
  user_id: string;
  chunk_type: NotegenChunkType;
  /** Null, always, whichever persona config drove generation. Null reads as
   *  the default persona, which is the convention every chunk written before
   *  the personas table already follows. The resolved persona supplies lens
   *  and depth to the generator and is never persisted onto a chunk. */
  persona_id: null;
  /** RAG embeddings are a separate track. Explicitly null, not omitted, so the
   *  intent is visible at the call site. */
  embedding: null;
  content: string;
  metadata: ChunkMetadata;
}

export interface NotegenStore {
  deleteGeneratedChunks(noteId: string): Promise<void>;
  insertChunks(rows: NotegenChunkInsert[]): Promise<void>;
  /** Atomic: flips 'generating' -> 'completed' only if the row is still
   *  'generating'. False means the staleness sweep took it first. */
  completeNotegen(noteId: string): Promise<boolean>;
  /** Atomic: flips 'generating' -> 'failed'. False means somebody else moved
   *  it. Terminal — there is no retry. */
  failNotegen(noteId: string): Promise<boolean>;
}

/** Two digits, matching ChunkMetadata.n's documented "01", "02", "03". */
function ordinal(index: number): string {
  return String(index + 1).padStart(2, "0");
}

export function generatedChunkRowsFor(args: {
  noteId: string;
  userId: string;
  note: GeneratedNote;
}): NotegenChunkInsert[] {
  const { noteId, userId, note } = args;

  const base = {
    note_id: noteId,
    user_id: userId,
    persona_id: null as null,
    embedding: null as null,
  };

  const rows: NotegenChunkInsert[] = [];

  // A blank string from the model is not a chunk. Guarding here rather than at
  // the call site keeps the rule in one place for all three types, and content
  // is a not-null column.
  const summary = note.summary?.trim();
  if (summary) {
    rows.push({
      ...base,
      chunk_type: "summary",
      content: summary,
      metadata: { seq: 0 },
    });
  }

  const takeaways = note.takeaways.map((t) => t.trim()).filter(Boolean);
  takeaways.forEach((content, index) => {
    rows.push({
      ...base,
      chunk_type: "takeaway",
      content,
      // n is the rendered ordinal, seq is position within the type. Both, so a
      // reader does not have to derive one from the other.
      metadata: { seq: index, n: ordinal(index) },
    });
  });

  const actions = note.actionItems.map((a) => a.trim()).filter(Boolean);
  actions.forEach((content, index) => {
    // No owner and no due. ROADMAP §5 keeps action items bare text until the
    // drawer that would edit those fields exists.
    rows.push({
      ...base,
      chunk_type: "action_item",
      content,
      metadata: { seq: index, n: ordinal(index) },
    });
  });

  return rows;
}

export async function persistGeneratedNote(args: {
  store: NotegenStore;
  noteId: string;
  userId: string;
  note: GeneratedNote;
}): Promise<void> {
  const { store, noteId, userId, note } = args;

  const rows = generatedChunkRowsFor({ noteId, userId, note });

  await store.deleteGeneratedChunks(noteId);
  if (rows.length > 0) await store.insertChunks(rows);

  // Zero rows still completes. A transcript with nothing decided in it is a
  // legitimate outcome, and leaving the row at 'generating' would hand it to
  // the staleness sweep an hour later for no reason.
  const completed = await store.completeNotegen(noteId);

  if (!completed) {
    throw new Error(
      `note ${noteId} was no longer 'generating' when its notes were ready`,
    );
  }
}
