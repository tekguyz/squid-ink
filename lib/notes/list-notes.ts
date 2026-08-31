import { createClient } from "@/lib/supabase/server";

/** One row of the notes list. Deliberately not the Note Detail view type —
 *  a list item needs an id, a label and a date, and nothing else. */
export interface NoteListItem {
  id: string;
  title: string | null;
  createdAt: string;
}

/**
 * The signed-in user's notes, newest first.
 *
 * No user_id filter — RLS supplies it, and the
 * notes_user_id_created_at_idx index serves exactly this ordering. A
 * redundant filter here would mask an RLS failure instead of exposing it.
 */
export async function listNotes(): Promise<NoteListItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("notes")
    .select("id, title, created_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to load notes: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
  }));
}
