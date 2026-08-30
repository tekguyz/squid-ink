import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in user's most recent note, or null if they have none.
 *
 * No user_id filter — RLS supplies it, and the notes_user_id_created_at_idx
 * index serves exactly this ordering.
 */
export async function getLatestNoteId(): Promise<string | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("notes")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (error) throw new Error(`Failed to load latest note: ${error.message}`);

  return data?.id ?? null;
}
