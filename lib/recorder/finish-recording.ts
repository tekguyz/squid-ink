import { saveBackup } from "@/lib/recorder/audio-backup";
import type { RecorderDeps } from "@/lib/recorder/browser-deps";
import { recordingPath, uploadRecording } from "@/lib/recorder/upload-audio";

/**
 * Everything that happens after the bytes stop arriving: back the audio up,
 * write the note row, move the audio to Storage, and settle the HUD.
 *
 * It was a 98-line callback inside useRecorder's `stop` until 2026-09-01. It
 * moved because none of it is React — it is a pipeline over the injected deps
 * and three store actions, and it holds the project's most consequential
 * ordering decisions. Here it can be driven directly, with no hook, no timers
 * and no rendered HUD in the way.
 *
 * `stop` keeps what genuinely belongs to the hook: awaiting the MediaRecorder's
 * stop event, tearing the capture graph down, and assembling the Blob from the
 * chunks it collected.
 */

/** The three store actions this pipeline drives, and nothing else. Narrower
 *  than the recorder store on purpose: a function that can reach `discard` or
 *  `beginStop` from here is a function that can put the HUD in a phase the
 *  caller did not ask for. */
export interface FinishRecordingStore {
  getState(): {
    beginUpload(): void;
    fail(message: string): void;
    finish(): void;
  };
}

export type FinishRecordingDeps = Pick<
  RecorderDeps,
  "now" | "getUserId" | "bucket" | "createNote" | "markUploadFailed"
>;

export async function finishRecording(args: {
  deps: FinishRecordingDeps;
  store: FinishRecordingStore;
  noteId: string;
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
}): Promise<void> {
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

  // THE DISCRIMINATOR for tier-1 reconciliation. markUploadFailed writes a
  // TERMINAL 'failed' on nothing more than "the client caught an error" —
  // unlike tier 2, which confirms the object is absent first. So it may only
  // fire for a throw from the Storage transfer, once a row actually exists to
  // fail. A throw from the session lookup or from createNote means there is
  // no row (or no session), and failing on those would strand notes for
  // reasons that have nothing to do with the audio.
  let rowWritten = false;

  try {
    const userId = await deps.getUserId();
    // Deterministic, so the row can name the object before the object exists.
    const path = recordingPath(userId, noteId);

    // The row is written BEFORE the bytes move, at processing_status
    // 'uploading' — true at this instant. A failed upload therefore leaves a
    // visible note whose audio is still in IndexedDB, rather than a silent
    // loss; the write below is what stops it sitting there until the cron.
    //
    // This runs exactly once per recording. stop() is only reachable from a
    // live recording, and there is no retry control, so the action is never
    // called twice for one note id from here.
    await deps.createNote({ noteId, audioStoragePath: path, durationSeconds });
    rowWritten = true;

    await uploadRecording({
      bucket: deps.bucket(),
      userId,
      noteId,
      blob,
      contentType: mimeType,
    });
  } catch (error) {
    // HUD first: fail() is synchronous, so the error pill does not wait on a
    // round trip.
    store.getState().fail(error instanceof Error ? error.message : String(error));

    // TIER 1 (docs/KNOWN_GAPS.md § Recorder HUD). Tier 2's staleness sweep
    // reaches this row only after an hour, and the Vercel Hobby cron fires
    // once a day. The failure is already certain here, so it is written here.
    //
    // ONE write, no retry. If this throws — an offline client is the obvious
    // case — tier 2 is still the net, and a retry loop here would be a second
    // reconciliation path for a single failure. The original error stays on
    // the HUD; this one is logged and dropped.
    //
    // The IndexedDB backup is untouched: it is discarded only on 'completed',
    // and a 'failed' row keeps the only copy of its audio indefinitely.
    if (rowWritten) {
      try {
        await deps.markUploadFailed(noteId);
      } catch (writeError) {
        console.error("Could not mark the note failed:", writeError);
      }
    }
    return;
  }

  // Outside the try on purpose. A throw from here is not an upload failure,
  // and must not reach the catch above and fail a note that uploaded fine.
  //
  // The backup is deliberately NOT discarded — it waits for
  // processing_status === 'completed', which the transcription pipeline owns.
  store.getState().finish();
}
