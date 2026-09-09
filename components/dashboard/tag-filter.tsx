import Link from "next/link";
import type { TagChip } from "@/lib/notes/tags";
import { TAG_CHIP } from "@/components/tags/tag-colors";

/**
 * The rail's tag list, App Surfaces 07 — a chip per tag with its note count.
 *
 * THIS is the clickable copy of a tag, and the badges on the feed rows are
 * not. A feed row is a Link covering the whole row; an anchor nested in an
 * anchor is invalid HTML and browsers unnest it, so a clickable badge there
 * would break the row link it sits inside. The rail has no such constraint,
 * and the mockup already puts the tag list here.
 *
 * A LINK, not a client-side filter. The filter is `?tag=<slug>` in the URL, so
 * it survives a refresh, can be shared, and is applied by the same server
 * query that builds the unfiltered feed — there is no second code path that
 * could disagree with the first.
 *
 * Renders nothing at all when the account has no tags. An empty "Tags"
 * heading over an empty strip is a promise of a feature the user has not used
 * yet, and the entry point for using it is on Note Detail, not here.
 *
 * Presentational and server-rendered: no state, no effect, no client boundary.
 */
export function TagFilter({
  chips,
  activeTag,
}: {
  chips: TagChip[];
  activeTag: string | null;
}) {
  if (chips.length === 0) return null;

  return (
    <div className="pt-[16px]">
      <div className="flex items-center px-[14px] pb-[6px]">
        <p className="font-mono text-muted text-[8.5px] tracking-[0.14em] uppercase">
          Tags
        </p>
        {activeTag ? (
          <Link
            href="/"
            className="font-mono text-accent-text focus-visible:outline-accent ml-auto text-[8.5px] tracking-[0.14em] uppercase focus-visible:outline-2 focus-visible:-outline-offset-2"
          >
            Clear
          </Link>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-[5px] px-[12px]">
        {chips.map((chip) => {
          const active = chip.id === activeTag;
          return (
            <Link
              key={chip.id}
              // Clicking the active chip clears the filter rather than
              // re-applying it — a filter with no way back off it is a trap.
              href={active ? "/" : `/?tag=${encodeURIComponent(chip.id)}`}
              aria-current={active ? "page" : undefined}
              aria-label={`${chip.name}, ${chip.count} ${chip.count === 1 ? "note" : "notes"}`}
              className={`${TAG_CHIP[chip.token]} font-mono focus-visible:outline-accent flex items-center gap-[6px] px-[8px] py-[3px] text-[9.5px] focus-visible:outline-2 focus-visible:-outline-offset-2 ${active ? "outline-accent outline-1 -outline-offset-1" : ""}`}
            >
              <span aria-hidden>{chip.name}</span>
              <span aria-hidden className="tabular-nums opacity-70">
                {chip.count}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
