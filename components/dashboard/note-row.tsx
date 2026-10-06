import Link from "next/link";
import { StatusPill } from "@/components/dashboard/status-pill";
import { TagBadge } from "@/components/tags/tag-badge";
import type { FeedNote } from "@/lib/notes/group-notes-by-day";

/**
 * One note in the feed, App Surfaces 01 — a row, not a card.
 *
 * Four tracks: when it happened, what it was, where it is in the pipeline, and
 * how much came out of it. The design's speaker avatars sit in the third track;
 * they are not rendered here because reading them means fetching every
 * transcript segment of every note on the screen. The status pill takes that
 * column instead, which is the fact a feed row actually needs — an 'uploading'
 * or 'failed' note must not look finished.
 *
 * That column is EMPTY on a finished note. StatusPill renders nothing for
 * `'completed'` (see its own header for why), so the track holds its 148px and
 * nothing else — the same "empty, not zeroed" rule the count column follows
 * below, and for the same reason.
 *
 * Presentational and server-rendered: no state, no effect, no client boundary.
 *
 * The count column is EMPTY, not zeroed, before generation runs — a note with
 * neither an action nor a span has nothing to report, and "0 ACTIONS / 0
 * SPANS" on every un-generated row is constant ink for a value that is usually
 * zero and never actionable. The column keeps its 96px track either way, so
 * the four-track alignment does not move.
 *
 * Neither line takes the accent. `accent` means "grounded in the source" and
 * is the app's only hue; spending it on a passive tally put the greenest thing
 * on a finished row on a number nobody acts on, competing with the Record
 * button and the Transcribing pill for the same signal. Both dropped to
 * `muted` on 2026-09-07 after a design critique.
 */

const COUNT =
  "font-mono text-muted text-[9px] tracking-[0.06em] tabular-nums uppercase";

export function NoteRow({ note }: { note: FeedNote }) {
  return (
    <Link
      href={`/notes/${note.id}`}
      // Below md (issue #91) the row is one column: the title, wrapping to two
      // lines rather than cut off, its preview, any status, then the time and
      // the counts on ONE mono line. `order` does the moving, so the drawn
      // four-track row above md is untouched. An empty status or count cell
      // is hidden there, because a phone row has no column to hold.
      className="border-rule-3 hover:bg-pane focus-visible:outline-accent grid grid-cols-[62px_minmax(0,1fr)_148px_96px] items-center gap-[14px] max-md:flex max-md:flex-wrap max-md:items-baseline max-md:gap-x-[7px] max-md:gap-y-[6px] max-md:px-[16px] max-md:py-[13px] border-b px-[24px] py-[11px] last:border-b-0 focus-visible:outline-2 focus-visible:-outline-offset-2"
    >
      <span className="font-mono text-meta-3 text-[10.5px] tabular-nums max-md:order-3 max-md:text-[11px] max-md:tracking-[0.1em] max-md:uppercase">
        {note.time}
        {note.duration ? (
          <>
            <br className="max-md:hidden" />
            <span className="md:hidden"> · </span>
            <span className="text-muted">{note.duration}</span>
          </>
        ) : null}
      </span>

      <span className="min-w-0 max-md:order-1 max-md:basis-full">
        <span className="font-header text-ink block truncate text-[15px] font-semibold max-md:line-clamp-2 max-md:text-[16px] max-md:leading-[1.3] max-md:whitespace-normal">
          {note.title}
        </span>
        {note.preview ? (
          <span className="font-body text-muted mt-[3px] block truncate text-[12.5px] max-md:mt-[4px] max-md:text-[13px]">
            {note.preview}
          </span>
        ) : null}
        {/* Under the title, not in a track of their own. App Surfaces 07
            right-aligns tags in a third column, but that column here is the
            status pill's and a row already carries four tracks; a fifth would
            crush the title on the 1280px the page is held at.

            Not clickable, on purpose: this row is a Link, and an anchor inside
            an anchor is invalid HTML that browsers unnest. The clickable copy
            of every tag is in the rail — see components/dashboard/
            tag-filter.tsx. */}
        {note.tags.length > 0 ? (
          <span className="mt-[5px] flex flex-wrap gap-[4px]">
            {note.tags.map((tag) => (
              <TagBadge key={tag.id} tag={tag} />
            ))}
          </span>
        ) : null}
      </span>

      <span className="max-md:order-2 max-md:basis-full max-md:empty:hidden">
        <StatusPill status={note.processingStatus} />
      </span>

      <span className={`${COUNT} block text-right max-md:order-4 max-md:text-left max-md:text-[11px] max-md:tracking-[0.1em] max-md:empty:hidden`}>
        {note.actionCount === 0 && note.spanCount === 0 ? null : (
          <>
            <span className="md:hidden">· </span>
            {note.actionCount} {note.actionCount === 1 ? "action" : "actions"}
            <br className="max-md:hidden" />
            <span className="md:hidden"> · </span>
            {note.spanCount} spans
          </>
        )}
      </span>
    </Link>
  );
}
