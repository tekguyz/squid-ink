import type { createClient } from "@/lib/supabase/server";
import {
  indexTags,
  type NoteTag,
  type NoteTagRow,
  type TagChip,
  type TagRow,
} from "@/lib/notes/tags";

/**
 * The two tag reads, and nothing else.
 *
 * NEITHER FILTERS ON user_id. RLS supplies it, and a redundant filter would
 * mask an RLS failure instead of exposing it — the same rule
 * lib/notes/get-note.ts and lib/notes/get-dashboard-feed.ts follow.
 *
 * Two flat reads joined in memory rather than one embedded select. PostgREST
 * can embed a related table, but note_tags' foreign keys are COMPOSITE —
 * (tag_id, user_id) — and the tag list of one account is small enough that
 * fetching it whole costs less than depending on how the embedder resolves a
 * two-column relationship.
 */

type Client = Awaited<ReturnType<typeof createClient>>;

async function readRows(
  supabase: Client,
  noteId: string | null,
): Promise<{ tags: TagRow[]; links: NoteTagRow[] }> {
  const linkQuery = supabase.from("note_tags").select("note_id, tag_id");

  const [{ data: tags, error: tagError }, { data: links, error: linkError }] =
    await Promise.all([
      supabase
        .from("tags")
        .select("id, slug, name, color_token")
        .returns<TagRow[]>(),
      (noteId === null ? linkQuery : linkQuery.eq("note_id", noteId)).returns<
        NoteTagRow[]
      >(),
    ]);

  if (tagError) throw new Error(`Failed to load tags: ${tagError.message}`);
  if (linkError)
    throw new Error(`Failed to load note tags: ${linkError.message}`);

  return { tags: tags ?? [], links: links ?? [] };
}

/** Every tag of the signed-in user, and which notes carry them. Feeds both the
 *  badges on the feed rows and the filter chips in the rail. */
export async function readTagIndex(
  supabase: Client,
): Promise<{ byNote: Map<string, NoteTag[]>; chips: TagChip[] }> {
  const { tags, links } = await readRows(supabase, null);
  return indexTags(tags, links);
}

/** The tags on one note. */
export async function readNoteTags(
  supabase: Client,
  noteId: string,
): Promise<NoteTag[]> {
  const { tags, links } = await readRows(supabase, noteId);
  return indexTags(tags, links).byNote.get(noteId) ?? [];
}
