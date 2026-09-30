import type { NotegenStatus, ProcessingStatus } from "@/lib/notes/view-types";

/**
 * Where a note is between "transcript written" and "note written" (issue #79).
 *
 * Transcription flips `processing_status` to 'completed', and note generation
 * runs seconds later inside the same `after()` block. `notegen_status` is null
 * until generation claims the note, so null means "not started yet", never
 * "done". Every client-side answer to "is this note still being written" lives
 * here, so the poll, the button and the banner cannot disagree.
 *
 * Client-safe: types only, no Supabase import.
 */

/** Transcript is in, the note is not written yet. */
export function isNoteWriting(
  processing: ProcessingStatus,
  notegen: NotegenStatus | null,
): boolean {
  return (
    processing === "completed" && (notegen === null || notegen === "generating")
  );
}

/** Nothing further will change on the row. Generation never runs for a failed
 *  transcription, so 'failed' is terminal on its own. */
export function isPipelineDone(
  processing: ProcessingStatus,
  notegen: NotegenStatus | null,
): boolean {
  return (
    processing === "failed" ||
    (processing === "completed" &&
      (notegen === "completed" || notegen === "failed"))
  );
}
