"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { normalizeCollectionName } from "@/lib/notes/collections";
import { fileNoteIntoCollection } from "@/lib/notes/file-note";

/**
 * Making a collection, renaming it, deleting it, and filing a note in or out
 * of one.
 *
 * Its own "use server". The directive is per module and app/notes/actions has
 * no shared entry point to put one in — the same reason recording.ts,
 * transcription.ts, persona.ts and tags.ts each carry their own.
 *
 * THE AUTHENTICATED COOKIE CLIENT, never the secret key. Every read and write
 * here is confined to the caller's own rows by RLS, so filing somebody else's
 * note matches nothing rather than erroring in a way that confirms the note
 * exists. No application-level user_id FILTER — that would mask an RLS failure
 * instead of exposing it. user_id is still SUPPLIED on insert, because it is a
 * column the row must carry and the insert policy checks it.
 *
 * IDEMPOTENT BY CONSTRUCTION, not by checking first. Both inserts are
 * `on conflict do nothing` against a unique key the database declares —
 * `collections (user_id, slug)` and `note_collections (note_id,
 * collection_id)`. A read-then-write would leave a window in which two tabs
 * both see "absent" and both insert.
 *
 * MANUAL ONLY, still. Nothing here matches a rule, scores a note or files
 * anything by itself. Auto-file rules shipped 2026-09-11 as their own tables
 * and their own decision — lib/collection-rules/ and
 * app/notes/actions/collection-rules.ts — and they reach this file at exactly
 * one point: they call the same lib/notes/file-note.ts write path
 * addNoteToCollection does, rather than a second insert beside it.
 */

export type CollectionWriteOutcome =
  /** The write landed, or was already true. Both are success. */
  | "written"
  /** The text normalises to nothing — see normalizeCollectionName. */
  | "invalid"
  /** Nobody is signed in, or the collection/note is not this user's. */
  | "not-found"
  /** A rename would collide with a collection this user already has. Reported
   *  rather than merged: two collections silently becoming one is data loss a
   *  user did not ask for. */
  | "duplicate";

type Client = Awaited<ReturnType<typeof createClient>>;

/** The signed-in user id, or null. Every action below starts here, because a
 *  write needs a user_id column value even though RLS is what enforces it. */
async function signedIn(supabase: Client): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** The uuid of a collection this user owns, by slug. Scoped by RLS, which is
 *  what makes another user's slug resolve to null rather than to their row. */
async function collectionIdFor(
  supabase: Client,
  slug: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("collections")
    .select("id")
    .eq("slug", slug)
    .maybeSingle<{ id: string }>();

  if (error) throw new Error(`Failed to read the collection: ${error.message}`);
  return data?.id ?? null;
}

/** Insert a collection unless this user already has that slug. Not exported:
 *  it is the shared half of createCollection and addNoteToCollection, and
 *  having the second call the first would cost a whole extra auth round trip
 *  for a row it already knows how to write. */
async function ensureCollection(
  supabase: Client,
  userId: string,
  slug: string,
  name: string,
): Promise<void> {
  const { error } = await supabase
    .from("collections")
    .upsert(
      { user_id: userId, slug, name },
      { onConflict: "user_id,slug", ignoreDuplicates: true },
    );
  if (error)
    throw new Error(`Failed to create the collection: ${error.message}`);
}

/** Make a collection. Typing a name this user already has resolves to that
 *  collection rather than failing — the same implicit, idempotent creation
 *  tags.ts documents, and what lets the picker on Note Detail create and file
 *  in one step. */
export async function createCollection(
  raw: string,
): Promise<CollectionWriteOutcome> {
  const normalized = normalizeCollectionName(raw);
  if (!normalized) return "invalid";

  const supabase = await createClient();
  const userId = await signedIn(supabase);
  if (!userId) return "not-found";

  await ensureCollection(supabase, userId, normalized.slug, normalized.name);

  revalidatePath("/collections");
  return "written";
}

/**
 * Rename a collection.
 *
 * THE SLUG MOVES WITH THE NAME. The slug is the URL segment as well as the
 * unique key, so a rename changes the page's address and the caller has to
 * navigate to the new one. Memberships are untouched: they point at the uuid.
 */
export async function renameCollection(
  slug: string,
  raw: string,
): Promise<CollectionWriteOutcome> {
  const normalized = normalizeCollectionName(raw);
  if (!normalized) return "invalid";

  const supabase = await createClient();
  const id = await collectionIdFor(supabase, slug);
  if (!id) return "not-found";

  const { error } = await supabase
    .from("collections")
    .update({ slug: normalized.slug, name: normalized.name })
    .eq("id", id);

  // 23505 is unique (user_id, slug) — the new name is a collection this user
  // already has.
  if (error) {
    if (error.code === "23505") return "duplicate";
    throw new Error(`Failed to rename the collection: ${error.message}`);
  }

  revalidatePath("/collections");
  revalidatePath(`/collections/${normalized.slug}`);
  return "written";
}

/**
 * Delete a collection.
 *
 * THE NOTES SURVIVE. `on delete cascade` on note_collections removes the
 * memberships and nothing else — a collection is a way of looking at notes,
 * not a container that owns them.
 */
export async function deleteCollection(
  slug: string,
): Promise<CollectionWriteOutcome> {
  const supabase = await createClient();
  const id = await collectionIdFor(supabase, slug);
  if (!id) return "not-found";

  const { error } = await supabase.from("collections").delete().eq("id", id);
  if (error) throw new Error(`Failed to delete the collection: ${error.message}`);

  revalidatePath("/collections");
  return "written";
}

/**
 * File a note into a collection.
 *
 * `raw` is either the slug of a collection that exists or a name for a new
 * one, so the picker on Note Detail can do both with one action. Creation is
 * implicit for the same reason it is for a tag: it is the only way a
 * collection comes into being from that screen.
 *
 * A note belonging to somebody else is refused by the DATABASE, not by a check
 * here: note_collections' foreign key is composite — (note_id, user_id)
 * references notes (id, user_id) — and a foreign key is validated as the
 * referenced table's owner, so it holds even though RLS does not apply to it.
 * The violation comes back as 23503 and is reported as "not-found", which is
 * the same answer a missing note gives and therefore leaks nothing.
 *
 * ADDING DOES NOT REMOVE: this only ever inserts one join row, so a note filed
 * into a second collection stays in the first.
 */
export async function addNoteToCollection(
  noteId: string,
  raw: string,
): Promise<CollectionWriteOutcome> {
  const normalized = normalizeCollectionName(raw);
  if (!normalized) return "invalid";

  const supabase = await createClient();
  const userId = await signedIn(supabase);
  if (!userId) return "not-found";

  await ensureCollection(supabase, userId, normalized.slug, normalized.name);

  const collectionId = await collectionIdFor(supabase, normalized.slug);
  if (!collectionId) return "not-found";

  // THE SHARED write path, extracted to lib/notes/file-note.ts on 2026-09-11
  // so the auto-file rule engine could call this insert rather than write a
  // second one beside it. The conflict clause and the 23503 handling moved
  // with it, unchanged; two copies would be two places for them to drift.
  const filed = await fileNoteIntoCollection(supabase, {
    noteId,
    collectionId,
    userId,
  });
  if (filed === "not-found") return "not-found";

  revalidatePath(`/notes/${noteId}`);
  revalidatePath("/collections");
  revalidatePath(`/collections/${normalized.slug}`);
  return "written";
}

/**
 * Take a note out of one collection.
 *
 * SCOPED TO ONE PAIR. The delete matches both note_id and collection_id, so a
 * note that sits in three collections loses exactly one membership and keeps
 * the other two. The collection row itself survives an empty result for the
 * same reason a tag does: deleting it is a different decision, made on the
 * collections screen.
 */
export async function removeNoteFromCollection(
  noteId: string,
  slug: string,
): Promise<CollectionWriteOutcome> {
  const supabase = await createClient();
  const collectionId = await collectionIdFor(supabase, slug);
  if (!collectionId) return "not-found";

  const { error } = await supabase
    .from("note_collections")
    .delete()
    .eq("note_id", noteId)
    .eq("collection_id", collectionId);

  if (error) throw new Error(`Failed to unfile the note: ${error.message}`);

  revalidatePath(`/notes/${noteId}`);
  revalidatePath("/collections");
  revalidatePath(`/collections/${slug}`);
  return "written";
}
