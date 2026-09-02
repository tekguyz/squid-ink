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

/** ROADMAP.md §5's Brief/Dense/Exhaustive. Carried on the type and the table;
 *  nothing consumes it yet — there is no model routing and no UI control. */
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
  title: string;
  meta: string;
  /** Where this note sits in the transcription pipeline. Read by the
   *  Transcribe button, which renders nothing at all once it is terminal. */
  processingStatus: ProcessingStatus;
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
