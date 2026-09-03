/** Types shared by the chat route, its ports, and the client panel.
 *
 *  This module is CLIENT-SAFE by design — the panel is a client component and
 *  must not pull in the server Supabase client, exactly as
 *  lib/notes/default-persona.ts is client-safe for the persona rail. Keep it
 *  types-only: no imports with runtime weight, no environment reads.
 */

/** Which retrieval path a turn used. Single-note stuffs the transcript;
 *  all-notes is the only mode with a search tool. */
export type ChatScope = "this_note" | "all_notes";

/** One resolved citation, persisted onto the assistant row so a `c<n>` chip
 *  still resolves after a reload — long after the tool result that produced
 *  it is gone. */
export interface Citation {
  /** The marker body: "t8" or "c3". */
  key: string;
  chunkId: string;
  noteId: string;
  /** Null until note auto-titling exists. The chip renders "Untitled note". */
  noteTitle: string | null;
  chunkType: string;
  /** "04:12", or null for a structured chunk that has no timestamp. */
  tsStart: string | null;
}

export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  scope: ChatScope | null;
  citations: Citation[];
  createdAt: string;
}

/** One row out of search_note_chunks. */
export interface SearchHit {
  chunkId: string;
  noteId: string;
  noteTitle: string | null;
  chunkType: string;
  content: string;
  tsStart: string | null;
  seq: number | null;
  score: number;
}
