/**
 * Collections: naming, and the shaping every collection surface reads.
 *
 * Pure. No I/O, no clock, no randomness — the same input is the same output on
 * the rail, on the detail page and on Note Detail's picker.
 *
 * CLIENT-SAFE by design, exactly like lib/notes/tags.ts and
 * lib/notes/default-persona.ts: the collection picker on Note Detail is a
 * client component and must not pull in the server Supabase client.
 *
 * MANUAL ONLY. Nothing here matches, scores or infers a membership. App
 * Surfaces 07 draws auto-file rules on a collection; that is a rule engine
 * with its own table and its own decision, and it is deliberately absent —
 * not half-built behind a flag, and not implied by a field here.
 */

/** A collection as a component renders it. `id` is the SLUG, never the uuid —
 *  the client never sees a uuid, for the reason personas.sql states: a uuid is
 *  per-user and does not survive a reseed. It is also the URL segment, so
 *  /collections/<id> is a link a user can keep. */
export interface NoteCollection {
  id: string;
  name: string;
}

/** A collection in the rail: the same thing plus how many notes it holds,
 *  which is what the rail prints beside each row. */
export interface CollectionChip extends NoteCollection {
  count: number;
}

/** Longest collection name a rail row can carry without wrapping into a
 *  paragraph. Enforced here rather than in the database: it is a product
 *  decision about a label, and a check constraint would reject rather than
 *  trim. Longer than a tag's 32 because a collection name is a phrase
 *  ("Q3 planning offsite"), not a word. */
const MAX_COLLECTION_LENGTH = 48;

/**
 * What the user typed, cleaned into a name and a key.
 *
 * The name is kept as typed, so "Q3 Planning" stays capitalised on the rail.
 * The slug is what the URL and the unique constraint use, which is why a
 * rename to "q3 planning" resolves to the collection that is already there
 * rather than to a second one beside it.
 *
 * Returns null for anything that normalises to nothing. An unnamed collection
 * is not a collection, and this is the one place that decides so.
 */
export function normalizeCollectionName(
  raw: string,
): { slug: string; name: string } | null {
  const name = raw
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_COLLECTION_LENGTH);

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length === 0 ? null : { slug, name };
}

/** A collections row as the database hands it over. */
export interface CollectionRow {
  id: string;
  slug: string;
  name: string;
}

/** A note_collections row as the database hands it over. */
export interface NoteCollectionRow {
  note_id: string;
  collection_id: string;
}

const toNoteCollection = (row: CollectionRow): NoteCollection => ({
  id: row.slug,
  name: row.name,
});

/**
 * Join the two reads into what the screens render.
 *
 * One pass, never one query per note: a feed of 128 notes must not become 128
 * round trips, which is the N+1 lib/notes/get-dashboard-feed.ts already avoids
 * for chunks and tags.
 *
 * MANY-TO-MANY IS THE WHOLE SHAPE. A note id maps to a LIST, and a collection
 * counts every note that names it. Nothing here picks a winner when a note
 * sits in two collections, because there is no winner to pick — both
 * memberships are true, and removing one leaves the other untouched.
 *
 * Both lists are sorted by name, so neither the rail nor a note's chips
 * reorder between renders. A list that reorders as counts change cannot be
 * aimed at.
 */
export function indexCollections(
  collections: readonly CollectionRow[],
  links: readonly NoteCollectionRow[],
): { byNote: Map<string, NoteCollection[]>; chips: CollectionChip[] } {
  const byId = new Map(collections.map((row) => [row.id, row]));
  const byNote = new Map<string, NoteCollection[]>();
  const counts = new Map<string, number>();

  for (const link of links) {
    const row = byId.get(link.collection_id);
    // A membership whose collection is not visible is not an error: RLS
    // filters both reads independently, and the honest answer to "a collection
    // you cannot see" is to render nothing rather than a blank row.
    if (!row) continue;

    const list = byNote.get(link.note_id) ?? [];
    list.push(toNoteCollection(row));
    byNote.set(link.note_id, list);
    counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
  }

  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name);

  for (const list of byNote.values()) list.sort(byName);

  // Every collection, including the empty ones. An empty collection is a real
  // thing a user just made and is about to file into; hiding it until it has a
  // member would hide the thing they are aiming at.
  const chips = collections
    .map((row) => ({ ...toNoteCollection(row), count: counts.get(row.id) ?? 0 }))
    .sort(byName);

  return { byNote, chips };
}
