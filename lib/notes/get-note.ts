import { createClient } from "@/lib/supabase/server";
import { buildNoteViewModel } from "./note-view-model";
import { getPersonas } from "./get-personas";
import type { Note } from "@/lib/notes/view-types";
import type { ChunkRow, NoteRow } from "./types";

/**
 * Fetch one note and its chunks for the signed-in user.
 *
 * Neither query filters on user_id. RLS supplies that, and adding a
 * belt-and-braces application filter would mask an RLS failure rather than
 * expose it — a note owned by someone else must read as "not found", which is
 * exactly what an RLS-filtered empty result produces.
 */
export async function getNote(id: string): Promise<Note | null> {
  const supabase = await createClient();

  // Issued together, not in sequence. Neither query depends on the other's
  // result, so awaiting the note first would add a whole round trip to every
  // successful load. The cost is one wasted chunk query when the note is not
  // visible — the rarer path, and RLS makes it return empty rather than leak.
  const [
    { data: note, error: noteError },
    { data: chunks, error: chunkError },
    personas,
  ] = await Promise.all([
    supabase.from("notes").select("*").eq("id", id).maybeSingle<NoteRow>(),
    supabase.from("note_chunks").select("*").eq("note_id", id).returns<ChunkRow[]>(),
    // Personas are per-user, not per-note, so this rides along rather than
    // waiting on the note. getPersonas throws on error; nothing to check here.
    getPersonas(),
  ]);

  if (noteError) throw new Error(`Failed to load note: ${noteError.message}`);
  if (chunkError) throw new Error(`Failed to load note chunks: ${chunkError.message}`);
  if (!note) return null;

  return buildNoteViewModel(note, chunks ?? [], personas);
}
