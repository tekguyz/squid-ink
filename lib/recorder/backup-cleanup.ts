import { discardBackup, listBackups } from "@/lib/recorder/audio-backup";
import type { ProcessingStatus } from "@/lib/notes/view-types";

/**
 * When a recording's IndexedDB backup may go (#12, decided 2026-09-25):
 *
 *   'completed' → at once. The transcript exists; the audio is in Storage.
 *   'failed'    → seven days after it failed. The blob may be the only copy of
 *                 the audio, and the seven days are the user's time to retry.
 *   anything else → never. An 'uploading' row is not a promise of audio, and
 *                 deleting on it would destroy the only copy.
 *
 * A backup whose note row the server does not return — no row was ever
 * written, or the row belongs to another account on this browser — is kept.
 * No row is no evidence, and this rule deletes only on evidence.
 *
 * "When it failed" is `notes.updated_at`, which the database's trigger stamps
 * on every write. Nothing moves a row out of 'failed', so the last write is
 * the failure itself — or a later edit, which only pushes deletion later, the
 * safe direction.
 */
export const FAILED_BACKUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface BackupNoteStatus {
  noteId: string;
  status: ProcessingStatus;
  updatedAtMs: number;
}

/** Pure, so the server applies it against its own clock: a browser clock that
 *  is days wrong must not be able to delete audio early. */
export function backupsToDiscard(rows: BackupNoteStatus[], nowMs: number): string[] {
  return rows
    .filter(
      (row) =>
        row.status === "completed" ||
        (row.status === "failed" && nowMs - row.updatedAtMs >= FAILED_BACKUP_TTL_MS),
    )
    .map((row) => row.noteId);
}

/**
 * One pass over the browser's backups. `safeToDiscard` is the server action
 * that reads the note rows and applies the rule above; this side only lists
 * and deletes. An id the server names that was never asked about is ignored.
 */
export async function cleanUpBackups(
  safeToDiscard: (noteIds: string[]) => Promise<string[]>,
): Promise<void> {
  const stored = (await listBackups()).map((backup) => backup.noteId);
  if (stored.length === 0) return;

  const asked = new Set(stored);
  for (const noteId of await safeToDiscard(stored)) {
    if (asked.has(noteId)) await discardBackup(noteId);
  }
}
