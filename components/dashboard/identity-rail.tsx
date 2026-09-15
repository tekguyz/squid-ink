import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import type { DayGroup } from "@/lib/notes/group-notes-by-day";
import type { TagChip } from "@/lib/notes/tags";
import { TagFilter } from "./tag-filter";

/**
 * The dashboard's left rail, App Surfaces 01.
 *
 * Two things in the mockup are deliberately absent. The team switcher and its
 * "FINTORY · 3 MEMBERS" line are scaffolding from a multi-tenant product this
 * one is not — docs/ROADMAP.md §9 locks single-owner — and there is no
 * display-name column, so the signed-in address is the identity. Calendar and
 * Sources render disabled rather than hidden: each is a real planned surface
 * with no backend, and a nav that grows an item later is worse than one that
 * says what is coming. Collections was one of them until 2026-09-09 and
 * Settings until 2026-09-13; both are now links, and since 2026-09-13 the
 * real links live in the shared components/app-nav.tsx.
 *
 * Presentational and server-rendered: no state, no effect, no client boundary.
 */

/** How much of the feed the rail repeats. The rail is a jump list, not a
 *  second copy of the feed sitting beside the first. */
const RAIL_DAYS = 2;
const RAIL_NOTES_PER_DAY = 5;

const NAV_ITEM =
  "flex items-center gap-[9px] border-l-2 px-[8px] py-[7px] text-[13px] font-body";
const GROUP_HEADING =
  "font-mono text-muted px-[14px] text-[8.5px] tracking-[0.14em] uppercase";

/** Two letters from the address, because there is no name to take them from.
 *  Falls back to a filing mark rather than to an empty box. */
function initials(email: string | null): string {
  const local = (email ?? "").split("@")[0]?.replace(/[^a-zA-Z0-9]/g, "") ?? "";
  return local.slice(0, 2).toUpperCase() || "··";
}

/** Not yet built. Rendered rather than hidden, and genuinely inert: disabled,
 *  no handler, no href. The copy names the state and nothing else — which
 *  phase each of these lands in is an open roadmap question.
 *
 *  MEASURED 2026-09-07, composited. `text-faint` under `opacity-60` came in at
 *  1.66:1 on `bg-rail` light and 1.88:1 dark. WCAG 1.4.3 exempts an inactive
 *  control, so that was conformant — but five of this rail's six nav items are
 *  disabled, and a nav whose entries sit under 2:1 does not read as "planned",
 *  it reads as a rendering fault. `faint` was already measured too weak for
 *  9px text in status-pill.tsx and replaced there; this reintroduced it and
 *  then halved it.
 *
 *  The dimming now applies to the LABEL only, and the badge that explains the
 *  state carries `muted` at full opacity — 4.78:1 light / 6.29:1 dark on
 *  `bg-rail`, clearing AA. The item still reads as off; the word saying why is
 *  legible. `title` is gone: browsers suppress pointer events on a disabled
 *  element, so that tooltip provably never rendered, and the badge is the only
 *  explanation a sighted user was ever going to get. */
function PendingItem({ label }: { label: string }) {
  return (
    <button
      type="button"
      disabled
      className={`${NAV_ITEM} text-faint w-full cursor-not-allowed border-transparent text-left`}
    >
      <span className="opacity-60">{label}</span>
      <span className="font-mono text-muted ml-auto text-[8.5px] tracking-[0.14em] uppercase">
        Soon
      </span>
    </button>
  );
}

export function IdentityRail({
  email,
  totalNotes,
  groups,
  tagChips,
  activeTag,
}: {
  email: string | null;
  totalNotes: number;
  groups: DayGroup[];
  tagChips: TagChip[];
  activeTag: string | null;
}) {
  const recent = groups.slice(0, RAIL_DAYS);

  return (
    <nav
      aria-label="Notes"
      // Below lg the rail sits ABOVE the feed (app/page.tsx), so its edge moves
      // to the bottom and it is capped, scrolling itself, so a long tag list
      // cannot push the feed off the screen.
      className="bg-rail border-rule flex min-h-0 flex-col overflow-hidden border-r scroll-thin max-lg:max-h-[40dvh] max-lg:overflow-y-auto max-lg:border-r-0 max-lg:border-b max-lg:pb-[12px]"
    >
      <div className="border-rule-3 max-lg:hidden flex items-center gap-[9px] border-b px-[14px] pt-[14px] pb-[12px]">
        {/* Square, not a circle. Circles are for people's faces in a
            transcript; this is a filing mark for an account. */}
        <span
          aria-hidden
          className="bg-tint text-accent-text font-mono flex h-[26px] w-[26px] flex-none items-center justify-center text-[10px]"
        >
          {initials(email)}
        </span>
        <span className="min-w-0">
          <span className="font-mono text-muted block truncate text-[9px]">
            {email ?? "Signed in"}
          </span>
        </span>
      </div>

      {/* The shared app nav, since 2026-09-13 — the same block every main
          screen's rail now opens with. All notes is current only when no tag
          filter narrows the feed. */}
      <AppNav current={activeTag ? undefined : "notes"} notesCount={totalNotes} />
      <div className="flex flex-col gap-px px-[8px] pt-[4px] pb-[4px] max-lg:hidden">
        <PendingItem label="Calendar" />
        <PendingItem label="Sources" />
      </div>

      {/* Directly under the nav, and above the recents, because it filters the
          list the recents are drawn from. Collections is a separate system
          with a screen of its own, linked above: a tag is a label on a note, a
          collection is a place a note is filed. Filtering this feed by
          collection is deliberately NOT a second control here — see
          supabase/schemas/collections.sql. */}
      <TagFilter chips={tagChips} activeTag={activeTag} />

      {/* Hidden below lg: stacked, the feed is directly underneath and these
          would be the same titles twice. */}
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-[10px] max-lg:hidden">
        {recent.map((group) => (
          <div key={group.key}>
            <p className={`${GROUP_HEADING} pt-[16px] pb-[6px]`}>{group.label}</p>
            <div className="flex flex-col gap-px px-[8px]">
              {group.notes.slice(0, RAIL_NOTES_PER_DAY).map((note) => (
                <Link
                  key={note.id}
                  href={`/notes/${note.id}`}
                  className="font-body text-ink-2 hover:bg-pane focus-visible:outline-accent block truncate px-[8px] py-[5px] text-[12.5px] focus-visible:outline-2 focus-visible:-outline-offset-2"
                >
                  {note.title}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

    </nav>
  );
}
