import Link from "next/link";
import type { DayGroup } from "@/lib/notes/group-notes-by-day";

/**
 * The dashboard's left rail, App Surfaces 01.
 *
 * Two things in the mockup are deliberately absent. The team switcher and its
 * "FINTORY · 3 MEMBERS" line are scaffolding from a multi-tenant product this
 * one is not — docs/ROADMAP.md §9 locks single-owner — and there is no
 * display-name column, so the signed-in address is the identity. Calendar,
 * Collections, Sources and Settings render disabled rather than hidden: each is
 * a real planned surface with no backend, and a nav that grows an item later is
 * worse than one that says what is coming.
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
const COUNT = "font-mono text-muted ml-auto text-[9.5px] tabular-nums";

/** Two letters from the address, because there is no name to take them from.
 *  Falls back to a filing mark rather than to an empty box. */
function initials(email: string | null): string {
  const local = (email ?? "").split("@")[0]?.replace(/[^a-zA-Z0-9]/g, "") ?? "";
  return local.slice(0, 2).toUpperCase() || "··";
}

/** Not yet built. Rendered rather than hidden, and genuinely inert: disabled,
 *  no handler, no href. The copy names the state and nothing else — which
 *  phase each of these lands in is an open roadmap question. */
function PendingItem({ label }: { label: string }) {
  return (
    <button
      type="button"
      disabled
      title="Not available yet"
      className={`${NAV_ITEM} text-faint w-full cursor-not-allowed border-transparent text-left opacity-60`}
    >
      {label}
      <span className="font-mono text-faint ml-auto text-[8.5px] tracking-[0.14em] uppercase">
        Soon
      </span>
    </button>
  );
}

export function IdentityRail({
  email,
  totalNotes,
  groups,
}: {
  email: string | null;
  totalNotes: number;
  groups: DayGroup[];
}) {
  const recent = groups.slice(0, RAIL_DAYS);

  return (
    <nav
      aria-label="Notes"
      className="bg-rail border-rule flex min-h-0 flex-col overflow-hidden border-r"
    >
      <div className="border-rule-3 flex items-center gap-[9px] border-b px-[14px] pt-[14px] pb-[12px]">
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

      <div className="flex flex-col gap-px px-[8px] pt-[10px] pb-[4px]">
        <span
          aria-current="page"
          className={`${NAV_ITEM} bg-raised border-accent text-ink`}
        >
          All notes
          <span className={COUNT}>{totalNotes}</span>
        </span>
        <PendingItem label="Calendar" />
        <PendingItem label="Collections" />
        <PendingItem label="Sources" />
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-[10px]">
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

      <div className="border-rule-3 mt-auto border-t px-[14px] py-[10px]">
        <button
          type="button"
          disabled
          title="Not available yet"
          className="font-body text-faint flex w-full cursor-not-allowed items-center gap-[8px] text-[12.5px] opacity-60"
        >
          Settings
          <span className="font-mono text-faint ml-auto text-[9px]">⌘,</span>
        </button>
      </div>
    </nav>
  );
}
