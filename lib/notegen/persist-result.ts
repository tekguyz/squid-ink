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
  /** A short, content-derived name for the note, written to notes.title.
   *
   *  Null when the model returned nothing usable. It is generated as ONE MORE
   *  FIELD on the same structured call that produces everything else here —
   *  never a second, separately-billed model call. */
  title: string | null;
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
  /** Writes notes.title ONLY where it is still null.
   *
   *  THE NULL-GUARD IS THE WHOLE POINT. notes.title is nullable with no
   *  default — "Untitled note" is a render-time fallback in
   *  lib/notes/note-view-model.ts, never a stored string — so "is null" is an
   *  exact test for "nobody has named this note". A title the user typed is
   *  non-null and this write matches zero rows against it.
   *
   *  FALSE MEANS THE WRITE DID NOT APPLY, AND IT MEANS TWO THINGS: the row
   *  already carried a title, or the UPDATE errored and the implementation
   *  logged it. They are deliberately not distinguished, because neither is a
   *  reason to fail the generation that produced the title — a note with the
   *  fallback name is a cosmetic loss, not a lost note. Do NOT widen this into
   *  a tagged union until a caller exists that would branch on the difference;
   *  the log line in generate-note.ts reports "kept" for both. */
  setTitleIfUnset(noteId: string, title: string): Promise<boolean>;
  /** Atomic: flips 'generating' -> 'completed' only if the row is still
   *  'generating'. False means the staleness sweep took it first. */
  completeNotegen(noteId: string): Promise<boolean>;
  /** Atomic: flips 'generating' -> 'failed'. False means somebody else moved
   *  it. Terminal — there is no retry. */
  failNotegen(noteId: string): Promise<boolean>;
}

/** What actually happened to the title, so the function log can say it.
 *
 *  "written" means the guarded UPDATE matched; "kept" means it did not, which
 *  covers both a title the user typed and a logged write error; "none" means
 *  the model returned nothing usable. Reported because the model returning a
 *  title and the row carrying one are different facts, and a log that only
 *  knows the first would say the note was titled when it was not. */
export interface PersistOutcome {
  title: "written" | "kept" | "none";
}

/** A title is a label, not a sentence. The model is asked for something
 *  short; this is the backstop for when it answers with a paragraph anyway,
 *  because a citation chip has to stay readable. Blank collapses to null so
 *  the fallback keeps rendering rather than a row holding an empty string. */
export const MAX_TITLE_LENGTH = 120;

export function normalizeTitle(value: string | null): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  if (trimmed.length <= MAX_TITLE_LENGTH) return trimmed;

  // Cut back to a word boundary when there is one, so a runaway answer does
  // not land in a citation chip ending mid-word. Falls through to a hard slice
  // for the pathological single-token case, which has no boundary to find.
  const cut = trimmed.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();
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
}): Promise<PersistOutcome> {
  const { store, noteId, userId, note } = args;

  const rows = generatedChunkRowsFor({ noteId, userId, note });

  await store.deleteGeneratedChunks(noteId);
  if (rows.length > 0) await store.insertChunks(rows);

  // Before the 'completed' flip, same position as the chunks — everything this
  // run produces lands while the row is still ours.
  //
  // THE SWEEP IS NOT A ROLLBACK FOR THIS ONE, AND SAYING SO PLAINLY MATTERS.
  // The staleness sweep only flips notegen_status to 'failed'; it does not
  // null the title. So a run that titles a note and then loses completeNotegen
  // leaves a permanently-'failed' note wearing this run's title, and there is
  // no retry to correct it. That is accepted rather than overlooked: a
  // content-derived title on a failed note still beats "Untitled note", and it
  // is the same trade the chunks already make. The guard lives in the store,
  // not here — one place decides whether the write applies.
  const title = normalizeTitle(note.title);
  // "kept" covers both a hand-typed title the guard refused and a logged write
  // error. Neither fails the generation; see NotegenStore.setTitleIfUnset.
  let titleOutcome: PersistOutcome["title"] = "none";
  if (title) {
    titleOutcome = (await store.setTitleIfUnset(noteId, title))
      ? "written"
      : "kept";
  }

  // Zero rows still completes. A transcript with nothing decided in it is a
  // legitimate outcome, and leaving the row at 'generating' would hand it to
  // the staleness sweep an hour later for no reason.
  const completed = await store.completeNotegen(noteId);

  if (!completed) {
    throw new Error(
      `note ${noteId} was no longer 'generating' when its notes were ready`,
    );
  }

  return { title: titleOutcome };
}
