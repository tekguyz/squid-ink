/**
 * Tags: naming, hue rotation and the shaping the feed and the rail both read.
 *
 * Pure. No I/O, no clock, no randomness — the hue a tag gets is a function of
 * its slug and nothing else, so the same name is the same colour on every
 * screen and after every reseed. supabase/schemas/tags.sql stores the token
 * that comes out of here, so an edit to the rotation cannot repaint tags that
 * already exist.
 *
 * CLIENT-SAFE by design, exactly like lib/notes/default-persona.ts: the tag
 * input on Note Detail is a client component and must not pull in the server
 * Supabase client.
 *
 * No colour is named here. `TagToken` is a token NAME; the colour it stands
 * for lives in app/globals.css and is reached through the static lookup in
 * components/tags/tag-colors.ts, because Tailwind cannot build a class name at
 * runtime.
 */

export type TagToken = "tag-1" | "tag-2" | "tag-3" | "tag-4" | "tag-5";

/** The whole palette. Five hues, fixed — App Surfaces 07 draws consistent
 *  hue-per-tag and no colour picker, and per-tag customisation is deliberately
 *  not part of this feature. */
export const TAG_TOKENS: readonly TagToken[] = [
  "tag-1",
  "tag-2",
  "tag-3",
  "tag-4",
  "tag-5",
];

/** A tag as a component renders it. `id` is the SLUG, never the uuid — the
 *  client never sees a uuid, for the reason personas.sql states: a uuid is
 *  per-user and does not survive a reseed. */
export interface NoteTag {
  id: string;
  name: string;
  token: TagToken;
}

/** A tag in the rail's filter list: the same thing plus how many notes carry
 *  it, which is what App Surfaces 07 prints beside each chip. */
export interface TagChip extends NoteTag {
  count: number;
}

/** Longest tag a badge can carry without becoming a sentence. Enforced here
 *  rather than in the database: it is a product decision about a label, and a
 *  check constraint would reject rather than trim. */
const MAX_TAG_LENGTH = 32;

/** What the user typed, cleaned into a name and a key.
 *
 *  The leading `#` is stripped, so App Surfaces 07's "TYPE # IN A NOTE" cue
 *  works literally as well as figuratively — the entry field prints its own
 *  `#`, and typing a second one is not an error.
 *
 *  Returns null for anything that normalises to nothing. An empty tag is not
 *  a tag, and this is the one place that decides so. */
export function normalizeTagName(
  raw: string,
): { slug: string; name: string } | null {
  const name = raw
    .replace(/^#+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TAG_LENGTH);

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length === 0 ? null : { slug, name };
}

/** Which of the five hues a slug takes.
 *
 *  Deterministic and case-closed: every slug lands on a token, so there is no
 *  "no colour" state to render. The multiplier is the usual small odd prime —
 *  this is a spread, not a hash with any security meaning. */
export function tokenForSlug(slug: string): TagToken {
  let sum = 0;
  for (let i = 0; i < slug.length; i += 1) {
    sum = (sum * 31 + slug.charCodeAt(i)) % 100_000;
  }
  return TAG_TOKENS[sum % TAG_TOKENS.length];
}

/** A tags row as the database hands it over. */
export interface TagRow {
  id: string;
  slug: string;
  name: string;
  color_token: TagToken;
}

/** A note_tags row as the database hands it over. */
export interface NoteTagRow {
  note_id: string;
  tag_id: string;
}

const toNoteTag = (row: TagRow): NoteTag => ({
  id: row.slug,
  name: row.name,
  // The STORED token, falling back to the derivation only for a row written
  // before the column existed. The column is not null, so this is belt and
  // braces against a hand-edited row, not a live path.
  token: TAG_TOKENS.includes(row.color_token)
    ? row.color_token
    : tokenForSlug(row.slug),
});

/**
 * Join the two reads into what the screens render.
 *
 * One pass, never one query per note: a feed of 128 notes must not become 128
 * round trips, which is the N+1 the dashboard's chunk query already avoids.
 *
 * Tags are sorted by name inside a note so a row's badges do not reorder
 * between renders, and the chip list is sorted the same way — the rail is a
 * filter list, and a list that reorders as counts change cannot be aimed at.
 */
export function indexTags(
  tags: readonly TagRow[],
  links: readonly NoteTagRow[],
): { byNote: Map<string, NoteTag[]>; chips: TagChip[] } {
  const byId = new Map(tags.map((row) => [row.id, row]));
  const byNote = new Map<string, NoteTag[]>();
  const counts = new Map<string, number>();

  for (const link of links) {
    const row = byId.get(link.tag_id);
    // A link whose tag is not visible is not an error: RLS filters both reads
    // independently, and the honest answer to "a tag you cannot see" is to
    // render nothing rather than a blank badge.
    if (!row) continue;

    const list = byNote.get(link.note_id) ?? [];
    list.push(toNoteTag(row));
    byNote.set(link.note_id, list);
    counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
  }

  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name);

  for (const list of byNote.values()) list.sort(byName);

  const chips = tags
    .map((row) => ({ ...toNoteTag(row), count: counts.get(row.id) ?? 0 }))
    .sort(byName);

  return { byNote, chips };
}
