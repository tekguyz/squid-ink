import { createClient } from "@/lib/supabase/server";
import { groupNotesByDay, type DayGroup } from "@/lib/notes/group-notes-by-day";
import { readFeedNotes } from "@/lib/notes/read-feed-notes";
import { readTagIndex } from "@/lib/notes/get-tags";
import { FEED_PAGE } from "@/lib/notes/feed-page";
import type { TagChip } from "@/lib/notes/tags";

/**
 * Everything the Dashboard renders.
 *
 * The two note queries and the tallying moved to lib/notes/read-feed-notes.ts
 * on 2026-09-09, when the collection detail page became the second screen that
 * renders the same row. What is left here is what is DASHBOARD-shaped: the tag
 * filter, the account total, and the signed-in address.
 *
 * Nothing filters on user_id. RLS supplies it, and a redundant filter would
 * mask an RLS failure instead of exposing it — the rule CLAUDE.md § Supabase
 * states.
 *
 * The note read is PAGED by `limit` (lib/notes/feed-page.ts): the newest
 * FEED_PAGE notes first, one more page per "Show older notes". It replaced a
 * flat 100-row cap on 2026-09-25 (#4), which left notes past the hundredth
 * unreachable and still put a hundred rows on screen.
 *
 * `totalNotes` therefore comes from PostgREST's exact count rather than from
 * the number of rows returned. The rail and the end-of-feed footer both print
 * it, and after the cap bites the row count is the size of the page, not the
 * size of the account.
 */

export interface DashboardFeed {
  /** How many notes THIS FEED shows, which is the account total until a tag
   *  filter narrows it. Split from totalNotes on 2026-09-09: one number
   *  cannot both label "All notes" in the rail and end a filtered feed, and
   *  reusing it made the rail claim the account held three notes whenever a
   *  tag matched three. */
  shownNotes: number;
  /** Every tag this account has, with counts, for the rail's filter list. */
  tagChips: TagChip[];
  /** The slug the feed is currently filtered to, echoed back so the rail can
   *  mark it. Null when nothing is filtered, and ALSO null when the requested
   *  slug matches no tag — a filter that is not applied must not be shown as
   *  applied. */
  activeTag: string | null;
  /** The signed-in account. There is no display-name column, so the address is
   *  the identity — the design's team switcher and member count are scaffolding
   *  from a multi-tenant product this one is not (docs/ROADMAP.md §9). */
  email: string | null;
  totalNotes: number;
  /** True when notes matching this feed exist past `limit`, so the page
   *  offers "Show older notes". */
  hasOlder: boolean;
  groups: DayGroup[];
}

/**
 * The feed, optionally narrowed to one tag.
 *
 * The tag index is read FIRST when a filter is asked for, because the note
 * query has to be narrowed before the limit applies — filtering the capped
 * page in memory would silently drop tagged notes that fell outside the most
 * recent page. That is one extra round trip, and only on the filtered path.
 */
export async function getDashboardFeed(
  now: Date,
  tagSlug: string | null = null,
  limit: number = FEED_PAGE,
): Promise<DashboardFeed> {
  const supabase = await createClient();

  const { byNote, chips } = await readTagIndex(supabase);

  // A slug nobody owns resolves to no filter rather than to an empty feed:
  // RLS already hid the other account's tag, and "no notes" would be a
  // confusing way to say "no such tag".
  const active = chips.some((chip) => chip.id === tagSlug) ? tagSlug : null;
  const matching =
    active === null
      ? null
      : [...byNote.entries()]
          .filter(([, tags]) => tags.some((tag) => tag.id === active))
          .map(([noteId]) => noteId);

  const [feed, { count: totalCount }, { data: auth }] = await Promise.all([
    readFeedNotes(supabase, {
      noteIds: matching,
      limit,
      tagsByNote: byNote,
    }),
    // The account total, never narrowed. head: true fetches no rows at all —
    // this is a count and nothing else, and it is what the rail's "All notes"
    // item labels itself with while a tag filter is applied to the feed.
    supabase.from("notes").select("id", { count: "exact", head: true }),
    // getUser, never getSession: the proxy revalidates the token on every
    // request and this reads the same revalidated identity.
    supabase.auth.getUser(),
  ]);

  return {
    email: auth?.user?.email ?? null,
    tagChips: chips,
    activeTag: active,
    shownNotes: feed.matched,
    hasOlder: feed.matched > feed.inputs.length,
    totalNotes: totalCount ?? feed.matched,
    groups: groupNotesByDay(feed.inputs, feed.counts, now),
  };
}
