import type { NoteCollection } from "@/lib/notes/collections";
import type { NoteTag } from "@/lib/notes/tags";

/** View types the Note Detail components consume. Shaped by
 *  lib/notes/note-view-model.ts from database rows. No colours live here —
 *  speakers carry a token name, and the token resolves in `app/globals.css`. */

export type SpeakerToken = "speaker-1" | "speaker-2" | "speaker-3";

/** Mirrors notes_processing_status_check in supabase/schemas/notes.sql, read
 *  back from the live catalog on 2026-09-01.
 *
 *  It lives here rather than in lib/notes/types.ts because client components
 *  need it — the Transcribe button branches on it — and types.ts already
 *  imports from this module. Declaring it there and importing it here would
 *  turn a one-way type dependency into a cycle. types.ts re-exports it. */
export type ProcessingStatus =
  | "local"
  | "uploading"
  | "analyzing"
  | "completed"
  | "failed";

/** Structured note generation's own status, independent of
 *  ProcessingStatus. Null means "not eligible yet" — the transcript does
 *  not exist. Declared here rather than in types.ts for the same reason
 *  ProcessingStatus is: client components import from this module. */
export type NotegenStatus = "generating" | "completed" | "failed";

export interface Speaker {
  name: string;
  initials: string;
  token: SpeakerToken;
}

export interface Segment {
  id: number;
  time: string;
  speaker: Speaker;
  text: string;
}

export interface Takeaway {
  n: string;
  segmentId: number;
  time: string;
  text: string;
}

export interface SpeakerStat {
  speaker: Speaker;
  talk: string;
  asked: string;
  fillers: string;
}

/** ROADMAP.md §5's Brief/Dense/Exhaustive. Carried on the type and on the
 *  `personas.depth` column.
 *
 *  CONSUMED, and settable. `lib/notegen/depth-policy.ts` has mapped it onto
 *  Gemini's thinking_level and a prompt scope since 2026-09-02, and
 *  `/personas` has written it since 2026-09-09 through
 *  `app/notes/actions/configure-persona.ts`. The union is validated there
 *  before the database sees it — the column's check constraint is the floor,
 *  not the guard, because a Server Action is a public HTTP endpoint. The
 *  runtime list and its predicate live in `lib/notes/persona-config.ts`. */
export type PersonaDepth = "brief" | "dense" | "exhaustive";

export interface Persona {
  id: string;
  name: string;
  sub: string;
  depth: PersonaDepth;
  takeaways: Takeaway[];
  actions: string[];
}

export interface ActionItem {
  text: string;
  owner: string;
  due: string;
  time: string;
  segmentId: number;
}

/** A stretch of prose, optionally closed by a citation chip. Modelled as runs
 *  so chips can sit inline without dangerouslySetInnerHTML. */
export interface CiteRun {
  text: string;
  cite?: { time: string; segmentId: number };
}

export interface Note {
  id: string;
  /** What this note is filed under. Sorted by name, and empty for an untagged
   *  note. Attached by lib/notes/get-note.ts rather than built in
   *  note-view-model.ts: tags live in their own two tables and have nothing to
   *  do with the chunk shaping that file exists for. */
  tags: NoteTag[];
  /** The collections this note is filed in, sorted by name. A LIST, because
   *  the join is many-to-many: a note sits in as many collections as it was
   *  filed into, and none of them is the primary one. Attached by
   *  lib/notes/get-note.ts, for the same reason tags are. */
  collections: NoteCollection[];
  /** Every collection the account has, so the picker can offer them. Read from
   *  the same index the memberships come from, which is why it costs no extra
   *  query. */
  collectionOptions: NoteCollection[];
  title: string;
  meta: string;
  /** Where this note sits in the transcription pipeline. Read by the
   *  Transcribe button, which renders nothing at all once it is terminal. */
  processingStatus: ProcessingStatus;
  /** Structured note generation's queue state. Read by the persona rail, which
   *  stops being interactive once the lens is frozen — this being non-null is
   *  half of that condition, and processingStatus leaving 'uploading' is the
   *  other half. */
  notegenStatus: NotegenStatus | null;
  /** The SLUG of the lens this note generates under, or null when nothing has
   *  been chosen. NEVER a uuid: every client-facing persona identifier in this
   *  project is a slug, because a uuid is per-user and does not survive a
   *  reseed. note-view-model.ts does the translation. */
  personaId: string | null;
  /** The Storage key for the recording, `{user_id}/{note_id}`, or null when the
   *  note has no audio. Carried raw rather than formatted — it is the key the
   *  playback helper fetches with, not something to display. */
  audioStoragePath: string | null;
  turnCount: number;
  duration: string;
  playhead: string;
  spansLinked: number;
  summary: CiteRun[];
  actionItems: ActionItem[];
  stats: SpeakerStat[];
  segments: Segment[];
  personas: Persona[];
  waveform: number[];
  sampleExchange: { question: string; answer: CiteRun[] };
}
