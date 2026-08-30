import { createClient } from "@/lib/supabase/server";
import { buildNoteViewModel } from "./note-view-model";
import type { Note } from "@/lib/mock/types";
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

  const { data: note, error: noteError } = await supabase
    .from("notes")
    .select("*")
    .eq("id", id)
    .maybeSingle<NoteRow>();

  if (noteError) throw new Error(`Failed to load note: ${noteError.message}`);
  if (!note) return null;

  const { data: chunks, error: chunkError } = await supabase
    .from("note_chunks")
    .select("*")
    .eq("note_id", id)
    .returns<ChunkRow[]>();

  if (chunkError) throw new Error(`Failed to load note chunks: ${chunkError.message}`);

  return buildNoteViewModel(note, chunks ?? []);
}
