"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Saving the per-account preferences on /settings.
 *
 * Its own "use server". The directive is per module and app/notes/actions has
 * no shared entry point to put one in — the same reason every sibling file
 * carries its own.
 *
 * THE AUTHENTICATED COOKIE CLIENT, never the secret key. RLS confines the
 * write to the caller's own row. user_id is SUPPLIED on the upsert because it
 * is the row's key and the insert policy checks it; it is never used as a
 * FILTER, which would mask an RLS failure instead of exposing it.
 *
 * ONE ACTION PER SECTION. /settings is one page, but each section owns its own
 * fields and its own save, so a section can later become its own route by
 * moving a component. Capture & audio is the only section with persisted
 * fields today. Appearance applies instantly through
 * components/theme-toggle.tsx and Connected apps is a stub, so neither has an
 * action here.
 */

export type SettingsWriteOutcome =
  /** The row now holds the submitted values. */
  | "written"
  /** The payload is not the shape this action accepts. A Server Action is a
   *  public HTTP endpoint, so the type annotation is not a guarantee. */
  | "invalid"
  /** Nobody is signed in. */
  | "not-found";

export async function saveCaptureSettings(input: {
  requireCitations: boolean;
}): Promise<SettingsWriteOutcome> {
  if (typeof input?.requireCitations !== "boolean") return "invalid";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "not-found";

  // An upsert, because a missing row is the ordinary state of an account that
  // has never saved. The conflict target is the primary key, so a second save
  // is an update of the same row and never a second row.
  const { error } = await supabase
    .from("user_settings")
    .upsert(
      { user_id: user.id, require_citations: input.requireCitations },
      { onConflict: "user_id" },
    );

  if (error) throw new Error(`Failed to save settings: ${error.message}`);

  revalidatePath("/settings");
  return "written";
}
