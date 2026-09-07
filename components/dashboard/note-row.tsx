import Link from "next/link";
import { StatusPill } from "@/components/dashboard/status-pill";
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
 * Presentational and server-rendered: no state, no effect, no client boundary.
 */

const COUNT = "font-mono text-muted text-[9px] tracking-[0.06em] tabular-nums uppercase";

export function NoteRow({ note }: { note: FeedNote }) {
  return (
    <Link
      href={`/notes/${note.id}`}
      className="border-rule-3 hover:bg-pane focus-visible:outline-accent grid grid-cols-[62px_minmax(0,1fr)_148px_96px] items-center gap-[14px] border-b px-[24px] py-[11px] focus-visible:outline-2 focus-visible:-outline-offset-2"
    >
      <span className="font-mono text-meta-3 text-[10.5px] tabular-nums">
        {note.time}
        {note.duration ? (
          <>
            <br />
            <span className="text-muted">{note.duration}</span>
          </>
        ) : null}
      </span>

      <span className="min-w-0">
        <span className="font-header text-ink block truncate text-[15px] font-semibold">
          {note.title}
        </span>
        {note.preview ? (
          <span className="font-body text-muted mt-[3px] block truncate text-[12.5px]">
            {note.preview}
          </span>
        ) : null}
      </span>

      <span>
        <StatusPill status={note.processingStatus} />
      </span>

      <span className={`${COUNT} block text-right`}>
        {note.actionCount} {note.actionCount === 1 ? "action" : "actions"}
        <br />
        <span className="text-accent-text">{note.spanCount} spans</span>
      </span>
    </Link>
  );
}
