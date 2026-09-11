/**
 * THE membership write. One insert, two callers.
 *
 * `app/notes/actions/collections.ts` calls it when a user files a note by
 * hand, and `lib/collection-rules/rule-ports.ts` calls it when a rule files
 * one automatically. It was extracted from the first on 2026-09-11 so the
 * second could not become a parallel write path — two inserts against the same
 * join table would be two places for the conflict clause to drift, and the
 * conflict clause is what makes filing idempotent.
 *
 * THE WHOLE WRITE SURFACE OF THE RULE ENGINE PASSES THROUGH HERE, plus one
 * insert into collection_rule_matches. Nothing in this file or its callers
 * writes to notes or note_chunks.
 *
 * NOT CLIENT-SAFE: it takes a Supabase client. The client is a PARAMETER
 * rather than built here, because the two callers hold different ones — the
 * action holds the cookie client, the rule engine holds either the deferred
 * client or the cron's service_role client.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** What the insert can come back as. "filed" covers both a new membership and
 *  one that was already there — a note either sits in the collection or it
 *  does not, and both outcomes mean it does. */
export type FileNoteOutcome = "filed" | "not-found";

/**
 * File a note into a collection, by uuid.
 *
 * IDEMPOTENT BY CONSTRUCTION, not by checking first. `on conflict do nothing`
 * against note_collections' (note_id, collection_id) primary key. A
 * read-then-write would leave a window in which two writers both see "absent"
 * and both insert.
 *
 * A note or collection belonging to somebody else is refused by the DATABASE,
 * not by a check here: both foreign keys on note_collections are composite, so
 * a cross-tenant pair comes back as 23503. That is reported as "not-found",
 * the same answer a missing row gives, so it leaks nothing about what exists.
 *
 * ADDING DOES NOT REMOVE. This only ever inserts one join row.
 */
export async function fileNoteIntoCollection(
  supabase: SupabaseClient,
  args: { noteId: string; collectionId: string; userId: string },
): Promise<FileNoteOutcome> {
  const { error } = await supabase.from("note_collections").upsert(
    {
      note_id: args.noteId,
      collection_id: args.collectionId,
      user_id: args.userId,
    },
    { onConflict: "note_id,collection_id", ignoreDuplicates: true },
  );

  if (error) {
    if (error.code === "23503") return "not-found";
    throw new Error(`Failed to file the note: ${error.message}`);
  }

  return "filed";
}
