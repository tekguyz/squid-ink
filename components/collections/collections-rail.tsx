import Link from "next/link";
import type { CollectionChip } from "@/lib/notes/collections";
import { CollectionCreate } from "./collection-create";

/**
 * The Collections screen's left rail: every collection, and the field that
 * makes a new one.
 *
 * A LIST OF LINKS, not a client-side selection. Which collection is open is
 * `/collections/<slug>` in the URL, so it survives a refresh and can be
 * shared, and the member list is read by the server for exactly that slug —
 * there is no second code path that could disagree with the first. The tag
 * filter in components/dashboard/tag-filter.tsx made the same choice.
 *
 * NO DRAG TARGET. App Surfaces 07 prints "DRAG A NOTE ONTO A COLLECTION" over
 * this rail. Filing is done from the note instead — see
 * components/collections/collection-picker.tsx — because a drag needs a drag
 * SOURCE on every feed row and a drop target here, and this codebase has no
 * drag primitive of any kind to build either from. The need the hint describes
 * is met; the gesture is not, and inventing one badly would be worse than the
 * button that works.
 *
 * Presentational and server-rendered apart from the create field, which is the
 * only thing here that writes.
 */

const ROW =
  "flex items-center gap-[9px] border-l-2 px-[8px] py-[7px] text-[13px] font-body";
const COUNT = "font-mono text-muted ml-auto text-[9.5px] tabular-nums";

export function CollectionsRail({
  chips,
  activeSlug,
}: {
  chips: CollectionChip[];
  activeSlug: string | null;
}) {
  return (
    <nav
      aria-label="Collections"
      className="bg-rail border-rule flex min-h-0 flex-col overflow-hidden border-r"
    >
      <div className="border-rule-3 flex items-center border-b px-[14px] pt-[14px] pb-[12px]">
        <p className="font-header text-ink text-[14px] font-semibold">
          Collections
        </p>
      </div>

      <div className="flex flex-col gap-px px-[8px] pt-[10px]">
        {/* Back to the feed. The Dashboard's own rail links here, so this rail
            has to link back or the screen is a one-way door. */}
        <Link
          href="/"
          className={`${ROW} text-ink-2 hover:bg-raised focus-visible:outline-accent border-transparent focus-visible:outline-2 focus-visible:-outline-offset-2`}
        >
          All notes
        </Link>
      </div>

      <CollectionCreate />

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-[8px] pt-[6px] pb-[10px]">
        {chips.length === 0 ? (
          <p className="font-body text-muted px-[8px] pt-[6px] text-[12px]">
            No collections yet. Name one above, then file notes into it from any
            note.
          </p>
        ) : (
          <div className="flex flex-col gap-px">
            {chips.map((chip) => {
              const active = chip.id === activeSlug;
              return (
                <Link
                  key={chip.id}
                  href={`/collections/${encodeURIComponent(chip.id)}`}
                  aria-current={active ? "page" : undefined}
                  className={`${ROW} focus-visible:outline-accent truncate focus-visible:outline-2 focus-visible:-outline-offset-2 ${
                    active
                      ? "bg-raised border-accent text-ink"
                      : "text-ink-2 hover:bg-raised border-transparent"
                  }`}
                >
                  <span className="truncate">{chip.name}</span>
                  {/* Its own label, or a screen reader reads the number as the
                      tail of the collection's name. */}
                  <span
                    className={COUNT}
                    aria-label={`${chip.count} ${chip.count === 1 ? "note" : "notes"}`}
                  >
                    {chip.count}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </nav>
  );
}
