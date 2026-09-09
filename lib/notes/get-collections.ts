import type { createClient } from "@/lib/supabase/server";
import {
  indexCollections,
  type CollectionChip,
  type CollectionRow,
  type NoteCollection,
  type NoteCollectionRow,
} from "@/lib/notes/collections";

/**
 * The collection reads, and nothing else.
 *
 * NONE OF THEM FILTERS ON user_id. RLS supplies it, and a redundant filter
 * would mask an RLS failure instead of exposing it — the same rule
 * lib/notes/get-note.ts, get-dashboard-feed.ts and get-tags.ts follow.
 *
 * Two flat reads joined in memory rather than one embedded select, the same
 * choice get-tags.ts made and for the same reason: note_collections' foreign
 * keys are COMPOSITE — (collection_id, user_id) — and the collection list of
 * one account is small enough that fetching it whole costs less than depending
 * on how PostgREST resolves a two-column relationship.
 */

type Client = Awaited<ReturnType<typeof createClient>>;

async function readRows(
  supabase: Client,
  noteId: string | null,
): Promise<{ collections: CollectionRow[]; links: NoteCollectionRow[] }> {
  const linkQuery = supabase
    .from("note_collections")
    .select("note_id, collection_id");

  const [
    { data: collections, error: collectionError },
    { data: links, error: linkError },
  ] = await Promise.all([
    supabase.from("collections").select("id, slug, name").returns<
      CollectionRow[]
    >(),
    (noteId === null ? linkQuery : linkQuery.eq("note_id", noteId)).returns<
      NoteCollectionRow[]
    >(),
  ]);

  if (collectionError)
    throw new Error(`Failed to load collections: ${collectionError.message}`);
  if (linkError)
    throw new Error(`Failed to load collection members: ${linkError.message}`);

  return { collections: collections ?? [], links: links ?? [] };
}

/** Every collection of the signed-in user, with its member count. Feeds the
 *  collections rail and Note Detail's picker. */
export async function readCollectionIndex(
  supabase: Client,
): Promise<{ byNote: Map<string, NoteCollection[]>; chips: CollectionChip[] }> {
  const { collections, links } = await readRows(supabase, null);
  return indexCollections(collections, links);
}

/** The collections one note sits in. A note in none returns an empty list,
 *  which is a state the picker renders rather than an error. */
export async function readNoteCollections(
  supabase: Client,
  noteId: string,
): Promise<NoteCollection[]> {
  const { collections, links } = await readRows(supabase, noteId);
  return indexCollections(collections, links).byNote.get(noteId) ?? [];
}

/**
 * One collection by slug, with the ids of the notes in it.
 *
 * Returns null when the slug matches nothing this user owns — which is the
 * same answer another user's slug gives, because RLS filters the lookup rather
 * than refusing it. The page turns that into a 404 and therefore leaks
 * nothing about whether the collection exists for somebody else.
 *
 * The member ids come back rather than the notes themselves: shaping a note
 * into a feed row is lib/notes/read-feed-notes.ts's job, and doing it in two
 * places is how the dashboard and this page would start to disagree.
 */
export async function readCollectionBySlug(
  supabase: Client,
  slug: string,
): Promise<{ collection: NoteCollection; noteIds: string[] } | null> {
  const { data: row, error } = await supabase
    .from("collections")
    .select("id, slug, name")
    .eq("slug", slug)
    .maybeSingle<CollectionRow>();

  if (error) throw new Error(`Failed to load collection: ${error.message}`);
  if (!row) return null;

  const { data: links, error: linkError } = await supabase
    .from("note_collections")
    .select("note_id, collection_id")
    .eq("collection_id", row.id)
    .returns<NoteCollectionRow[]>();

  if (linkError)
    throw new Error(`Failed to load collection members: ${linkError.message}`);

  return {
    collection: { id: row.slug, name: row.name },
    noteIds: (links ?? []).map((link) => link.note_id),
  };
}
