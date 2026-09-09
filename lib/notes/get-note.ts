import { createClient } from "@/lib/supabase/server";
import { buildNoteViewModel } from "./note-view-model";
import { getPersonas } from "./get-personas";
import { readNoteTags } from "./get-tags";
import { readCollectionIndex } from "./get-collections";
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
    tags,
    collectionIndex,
  ] = await Promise.all([
    supabase.from("notes").select("*").eq("id", id).maybeSingle<NoteRow>(),
    supabase.from("note_chunks").select("*").eq("note_id", id).returns<ChunkRow[]>(),
    // Personas are per-user, not per-note, so this rides along rather than
    // waiting on the note. getPersonas throws on error; nothing to check here.
    getPersonas(),
    // Rides along for the same reason personas do: it depends on nothing the
    // other queries return. Its two reads are scoped by RLS, so a note this
    // user cannot see resolves to no tags rather than to somebody else's.
    readNoteTags(supabase, id),
    // The whole collection index rather than this note's memberships alone.
    // The picker offers every collection the account has, and the index is one
    // read that answers both questions — asking twice would be a second round
    // trip for rows already in hand.
    readCollectionIndex(supabase),
  ]);

  if (noteError) throw new Error(`Failed to load note: ${noteError.message}`);
  if (chunkError) throw new Error(`Failed to load note chunks: ${chunkError.message}`);
  if (!note) return null;

  // Attached rather than passed in. buildNoteViewModel shapes chunks into the
  // reading surface; tags are a separate pair of tables that shaping knows
  // nothing about, and threading them through it would only widen a signature.
  return {
    ...buildNoteViewModel(note, chunks ?? [], personas),
    tags,
    collections: collectionIndex.byNote.get(id) ?? [],
    collectionOptions: collectionIndex.chips,
  };
}
