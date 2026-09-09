import type { NoteTag } from "@/lib/notes/tags";
import { TAG_CHIP } from "./tag-colors";

/**
 * One tag, as App Surfaces 07 draws it: mono, small, a wash of its own hue,
 * no border and no radius. The badge is the shape; what it does depends on
 * where it sits.
 *
 * PRESENTATIONAL ONLY, and that is a decision rather than an omission. On the
 * feed a row is a Link covering the whole row, and an anchor inside an anchor
 * is invalid HTML that browsers silently unnest — so the badge on a row shows
 * a fact and the RAIL carries the clickable copy of the same tag. See
 * components/dashboard/tag-filter.tsx.
 */
export function TagBadge({ tag }: { tag: NoteTag }) {
  return (
    <span
      className={`${TAG_CHIP[tag.token]} font-mono px-[7px] py-[2px] text-[9px]`}
    >
      {tag.name}
    </span>
  );
}
