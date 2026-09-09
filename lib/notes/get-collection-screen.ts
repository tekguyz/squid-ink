import { createClient } from "@/lib/supabase/server";
import { groupNotesByDay, type DayGroup } from "@/lib/notes/group-notes-by-day";
import {
  readCollectionBySlug,
  readCollectionIndex,
} from "@/lib/notes/get-collections";
import { readFeedNotes } from "@/lib/notes/read-feed-notes";
import { readTagIndex } from "@/lib/notes/get-tags";
import type { CollectionChip, NoteCollection } from "@/lib/notes/collections";

/**
 * What the two Collections routes render.
 *
 * The index and the detail page share a rail, so they share this file: the
 * rail's rows are the same read on both, and splitting them would be two
 * queries that must agree and one day would not.
 *
 * The notes come back through lib/notes/read-feed-notes.ts, the same path the
 * Dashboard uses. That is the point of the extraction — a note's preview line
 * and its action count are the same facts on both screens, so they are read by
 * the same code rather than reimplemented against the same tables.
 *
 * Nothing here filters on user_id. RLS supplies it.
 */

/** The same bound the Dashboard applies, and for the same reason: a cap, not a
 *  page size, because nothing exists yet to ask for the next page. A
 *  collection over this size shows its most recent hundred. */
const COLLECTION_LIMIT = 100;

export interface CollectionsIndex {
  chips: CollectionChip[];
}

export interface CollectionScreen extends CollectionsIndex {
  collection: NoteCollection;
  groups: DayGroup[];
  /** How many notes are IN the collection, which is not `groups`' row count
   *  once COLLECTION_LIMIT bites. */
  noteCount: number;
}

/** Every collection, with counts. The index route and the rail both read it. */
export async function getCollectionsIndex(): Promise<CollectionsIndex> {
  const supabase = await createClient();
  const { chips } = await readCollectionIndex(supabase);
  return { chips };
}

/**
 * One collection and the notes in it, or null when the slug matches nothing
 * this user owns.
 *
 * Null rather than an empty screen: another user's collection and a deleted
 * one are the same answer here, because RLS filters the lookup rather than
 * refusing it, and the route turns both into a 404.
 *
 * `now` is a parameter rather than a `new Date()` inside the grouping, so
 * nothing in a render path reads the clock — the rule app/page.tsx follows.
 */
export async function getCollectionScreen(
  slug: string,
  now: Date,
): Promise<CollectionScreen | null> {
  const supabase = await createClient();

  // The rail's rows and this collection's membership are independent reads, so
  // they are issued together rather than in sequence.
  const [{ chips }, found] = await Promise.all([
    readCollectionIndex(supabase),
    readCollectionBySlug(supabase, slug),
  ]);

  if (!found) return null;

  // Tags ride along because a feed row renders its note's tags, and the row is
  // the Dashboard's row — not a second, tagless copy of it.
  const { byNote: tagsByNote } = await readTagIndex(supabase);

  const feed = await readFeedNotes(supabase, {
    noteIds: found.noteIds,
    limit: COLLECTION_LIMIT,
    tagsByNote,
  });

  return {
    chips,
    collection: found.collection,
    groups: groupNotesByDay(feed.inputs, feed.counts, now),
    noteCount: found.noteIds.length,
  };
}
