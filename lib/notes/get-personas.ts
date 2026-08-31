import { createClient } from "@/lib/supabase/server";
import type { PersonaRow } from "./types";

/**
 * The signed-in user's personas, in rail order.
 *
 * No user_id filter — RLS supplies it, and personas_user_id_sort_order_idx
 * serves exactly this ordering. A user with no rows gets an empty array, not
 * an error: that is also what another user's rows look like once RLS has
 * filtered them, and the two must be indistinguishable.
 */
export async function getPersonas(): Promise<PersonaRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("personas")
    .select("*")
    .order("sort_order", { ascending: true })
    .returns<PersonaRow[]>();

  if (error) throw new Error(`Failed to load personas: ${error.message}`);

  return data ?? [];
}
