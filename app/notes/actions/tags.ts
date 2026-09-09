"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { normalizeTagName, tokenForSlug } from "@/lib/notes/tags";

/**
 * Applying and removing a tag on a note.
 *
 * Its own "use server". The directive is per module and app/notes/actions has
 * no shared entry point to put one in — the same reason recording.ts,
 * transcription.ts and persona.ts each carry their own.
 *
 * THE AUTHENTICATED COOKIE CLIENT, never the secret key. Every read and write
 * here is confined to the caller's own rows by RLS, so tagging somebody else's
 * note matches nothing rather than erroring in a way that confirms the note
 * exists. No application-level user_id FILTER — that would mask an RLS failure
 * instead of exposing it. user_id is still SUPPLIED on insert, because it is a
 * column the row must carry and the insert policy checks it.
 *
 * IDEMPOTENT BY CONSTRUCTION, not by checking first. Both writes are
 * `on conflict do nothing` against a unique key the database declares —
 * `tags (user_id, slug)` and `note_tags (note_id, tag_id)`. A read-then-write
 * would leave a window in which two tabs both see "absent" and both insert.
 *
 * MANUAL ONLY. Nothing here suggests, infers or generates a tag, and no
 * generation pipeline calls it — see the service_role note at the foot of
 * supabase/schemas/tags.sql.
 */

export type TagWriteOutcome =
  /** The write landed, or was already true. Both are success. */
  | "written"
  /** The text normalises to nothing — see normalizeTagName. */
  | "invalid"
  /** Nobody is signed in, or the note is not this user's. */
  | "not-found";

/** The tag id for a name, creating the tag if this user does not have it.
 *
 *  Creation is IMPLICIT: there is no tag-management surface in this feature,
 *  so typing a new name is the only way a tag comes into being. The hue is
 *  assigned once, here, and stored — see lib/notes/tags.ts. */
async function tagIdFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  slug: string,
  name: string,
): Promise<string | null> {
  const { error } = await supabase.from("tags").upsert(
    { user_id: userId, slug, name, color_token: tokenForSlug(slug) },
    { onConflict: "user_id,slug", ignoreDuplicates: true },
  );
  if (error) throw new Error(`Failed to create the tag: ${error.message}`);

  const { data, error: readError } = await supabase
    .from("tags")
    .select("id")
    .eq("slug", slug)
    .maybeSingle<{ id: string }>();

  if (readError) throw new Error(`Failed to read the tag: ${readError.message}`);
  return data?.id ?? null;
}

/**
 * Put a tag on a note.
 *
 * A note belonging to somebody else is refused by the DATABASE, not by a check
 * here: note_tags' foreign key is composite — (note_id, user_id) references
 * notes (id, user_id) — and a foreign key is validated as the referenced
 * table's owner, so it holds even though RLS does not apply to it. The
 * violation comes back as 23503 and is reported as "not-found", which is the
 * same answer a missing note gives and therefore leaks nothing.
 */
export async function addNoteTag(
  noteId: string,
  raw: string,
): Promise<TagWriteOutcome> {
  const normalized = normalizeTagName(raw);
  if (!normalized) return "invalid";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "not-found";

  const tagId = await tagIdFor(
    supabase,
    user.id,
    normalized.slug,
    normalized.name,
  );
  if (!tagId) return "not-found";

  const { error } = await supabase
    .from("note_tags")
    .upsert(
      { note_id: noteId, tag_id: tagId, user_id: user.id },
      { onConflict: "note_id,tag_id", ignoreDuplicates: true },
    );

  // 23503 is the composite foreign key refusing a note this user does not own.
  if (error) {
    if (error.code === "23503") return "not-found";
    throw new Error(`Failed to tag the note: ${error.message}`);
  }

  revalidatePath(`/notes/${noteId}`);
  revalidatePath("/");
  return "written";
}

/**
 * Take a tag off a note.
 *
 * The TAG ROW SURVIVES. Removing the last note from a tag leaves an unused
 * tag rather than deleting it — deletion is a different decision, and this
 * feature has no surface that makes it.
 *
 * Matching the tag by slug through a subquery would need a join PostgREST
 * cannot express in a delete, so the id is read first. That read is scoped by
 * RLS, which is what makes another user's slug resolve to nothing.
 */
export async function removeNoteTag(
  noteId: string,
  slug: string,
): Promise<TagWriteOutcome> {
  const supabase = await createClient();

  const { data, error: readError } = await supabase
    .from("tags")
    .select("id")
    .eq("slug", slug)
    .maybeSingle<{ id: string }>();

  if (readError) throw new Error(`Failed to read the tag: ${readError.message}`);
  if (!data) return "not-found";

  const { error } = await supabase
    .from("note_tags")
    .delete()
    .eq("note_id", noteId)
    .eq("tag_id", data.id);

  if (error) throw new Error(`Failed to untag the note: ${error.message}`);

  revalidatePath(`/notes/${noteId}`);
  revalidatePath("/");
  return "written";
}
