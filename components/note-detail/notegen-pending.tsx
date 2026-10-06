"use client";

import { isNoteWriting } from "@/lib/notes/notegen-progress";
import type { NotegenStatus, ProcessingStatus } from "@/lib/notes/view-types";

/**
 * Says so while the summary, takeaways and action items are still being
 * written, instead of leaving three blank rules that look like a finished,
 * empty note (issue #79).
 *
 * Always mounted, filled later: a role="status" region that appears together
 * with its text is not reliably announced (same reason as transcribe-button's
 * notice). Empty, it is `sr-only` and takes no space.
 *
 * `gaveUp` is the poll's time cap. Past it nothing will refresh the page, so
 * the banner stops promising that the text will appear on its own.
 */
export function NotegenPending({
  processing,
  notegen,
  sectionsEmpty,
  gaveUp,
}: {
  processing: ProcessingStatus;
  notegen: NotegenStatus | null;
  /** At least one of summary, takeaways, action items has nothing in it. */
  sectionsEmpty: boolean;
  gaveUp: boolean;
}) {
  const visible = isNoteWriting(processing, notegen) && sectionsEmpty;

  const text = gaveUp
    ? "Still writing the note. Refresh to check."
    : "Writing the note. The summary, takeaways and action items will appear here.";

  return (
    <p
      role="status"
      className={
        visible
          ? "mb-4 bg-notice-bg px-[9px] py-[7px] text-[11.5px] leading-[1.5] text-notice max-md:text-[13px]"
          : "sr-only"
      }
    >
      {visible ? text : null}
    </p>
  );
}
