import { loadBackup, saveBackup } from "@/lib/recorder/audio-backup";
import type { RecorderDeps } from "@/lib/recorder/browser-deps";
import { recordingPath, uploadRecording } from "@/lib/recorder/upload-audio";

/**
 * Everything that happens after the bytes stop arriving: back the audio up,
 * write the note row, move the audio to Storage, and settle the HUD.
 *
 * It was a 98-line callback inside useRecorder's `stop` until 2026-09-01. It
 * moved because none of it is React — it is a pipeline over the injected deps
 * and four store actions, and it holds the project's most consequential
 * ordering decisions. Here it can be driven directly, with no hook, no timers
 * and no rendered HUD in the way.
 *
 * `stop` keeps what genuinely belongs to the hook: awaiting the MediaRecorder's
 * stop event, tearing the capture graph down, and assembling the Blob from the
 * chunks it collected.
 */

/** The store actions this pipeline drives, and nothing else. Narrower than
 *  the recorder store on purpose: a function that can reach `discard` or
 *  `beginStop` from here is a function that can put the HUD in a phase the
 *  caller did not ask for. */
export interface FinishRecordingStore {
  getState(): {
    beginUpload(): void;
    beginRetry(): void;
    fail(cause: "save-failed"): void;
    finish(): void;
  };
}

export type FinishRecordingDeps = Pick<
  RecorderDeps,
  "now" | "getUserId" | "bucket" | "createNote" | "markUploadFailed" | "reopenFailedUpload"
>;

/** What a save left behind, so Retry knows which write to make first. */
export interface SaveOutcome {
  /** The note row exists — written now or by an earlier attempt. */
  rowWritten: boolean;
}

export async function finishRecording(args: {
  deps: FinishRecordingDeps;
  store: FinishRecordingStore;
  noteId: string;
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
}): Promise<SaveOutcome> {
  const { deps, store, noteId, blob, mimeType, durationSeconds } = args;

  // Backup BEFORE the network. A failed upload must leave recoverable audio.
  await saveBackup({
    noteId,
    blob,
    mimeType,
    durationSeconds,
    savedAtMs: deps.now(),
  });

  store.getState().beginUpload();
  return save({ deps, store, noteId, blob, mimeType, durationSeconds, rowWritten: false });
}

/**
 * Retry (#24): save again from the audio kept on this device, for the same
 * note id and Storage path. One press, deletes nothing. `rowWritten` is what
 * the failed attempt reported: a row that exists is moved back from 'failed'
 * to 'uploading' first; a row that was never written is written, as the first
 * save does.
 */
export async function retrySave(args: {
  deps: FinishRecordingDeps;
  store: FinishRecordingStore;
  noteId: string;
  rowWritten: boolean;
}): Promise<SaveOutcome> {
  const { deps, store, noteId, rowWritten } = args;
  store.getState().beginRetry();

  const kept = await loadBackup(noteId);
  if (!kept) {
    // Not reachable in one session: the backup is written before any save can
    // fail, and cleanup runs only on page load. Logged, and the pill stays.
    console.error("Retry found no kept audio for note", noteId);
    store.getState().fail("save-failed");
    return { rowWritten };
  }

  return save({
    deps,
    store,
    noteId,
    blob: kept.blob,
    mimeType: kept.mimeType,
    durationSeconds: kept.durationSeconds,
    rowWritten,
  });
}

async function save(args: {
  deps: FinishRecordingDeps;
  store: FinishRecordingStore;
  noteId: string;
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
  rowWritten: boolean;
}): Promise<SaveOutcome> {
  const { deps, store, noteId, blob, mimeType, durationSeconds } = args;
  let rowWritten = args.rowWritten;

  // THE DISCRIMINATOR for tier-1 reconciliation. markUploadFailed writes a
  // TERMINAL 'failed' on nothing more than "the client caught an error" —
  // unlike tier 2, which confirms the object is absent first. So it may only
  // fire for a throw from the Storage transfer, once a row at 'uploading'
  // actually exists to fail. A throw from the session lookup, from createNote
  // or from reopenFailedUpload means there is no such row, and failing on
  // those would strand notes for reasons that have nothing to do with the
  // audio.
  let uploading = false;

  try {
    const userId = await deps.getUserId();
    // Deterministic, so the row can name the object before the object exists.
    const path = recordingPath(userId, noteId);

    // The row is written BEFORE the bytes move, at processing_status
    // 'uploading' — true at this instant. A failed upload therefore leaves a
    // visible note whose audio is still in IndexedDB, rather than a silent
    // loss; the write below is what stops it sitting there until the cron.
    //
    // A retry whose row exists does not write it again: createNote is an
    // upsert that would set 'uploading' over anything, 'analyzing' included.
    // reopenFailedUpload moves it back from 'failed' only. If the first
    // upload in fact landed and the note has moved on, it matches no row and
    // the upload below rewrites the same bytes from the same backup to the
    // same path — the object does not change.
    if (rowWritten) {
      await deps.reopenFailedUpload(noteId);
    } else {
      await deps.createNote({ noteId, audioStoragePath: path, durationSeconds });
      rowWritten = true;
    }
    uploading = true;

    await uploadRecording({
      bucket: deps.bucket(),
      userId,
      noteId,
      blob,
      contentType: mimeType,
    });
  } catch (error) {
    // HUD first: fail() is synchronous, so the error pill does not wait on a
    // round trip. The raw error is logged; the HUD shows plain words.
    console.error("Could not save the recording:", error);
    store.getState().fail("save-failed");

    // TIER 1 (docs/KNOWN_GAPS.md § Recorder HUD). Tier 2's staleness sweep
    // reaches this row only after an hour, and the Vercel Hobby cron fires
    // once a day. The failure is already certain here, so it is written here.
    //
    // ONE write per attempt, no automatic retry. If this throws — an offline
    // client is the obvious case — tier 2 is still the net. The raw error is
    // logged and dropped.
    //
    // The IndexedDB backup is untouched here. A 'failed' row keeps the only
    // copy of its audio for seven days (lib/recorder/backup-cleanup.ts, #12),
    // and Retry reads it back from there.
    if (uploading) {
      try {
        await deps.markUploadFailed(noteId);
      } catch (writeError) {
        console.error("Could not mark the note failed:", writeError);
      }
    }
    return { rowWritten };
  }

  // Outside the try on purpose. A throw from here is not an upload failure,
  // and must not reach the catch above and fail a note that uploaded fine.
  //
  // The backup is deliberately NOT discarded — it waits for
  // processing_status === 'completed', which the transcription pipeline owns,
  // and is then dropped on the next page load (lib/recorder/backup-cleanup.ts).
  store.getState().finish();
  return { rowWritten };
}
