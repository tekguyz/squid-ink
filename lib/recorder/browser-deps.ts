"use client";

import { createClient } from "@/lib/supabase/client";
import {
  backupsSafeToDiscard,
  createRecordedNote,
  markUploadFailed,
  reopenFailedUpload,
} from "@/app/notes/actions/recording";
import { startCapture } from "@/lib/recorder/capture";
import type { RecordingMode } from "@/lib/recorder/recording-mode";
import { AUDIO_BUCKET, type StorageBucketLike } from "@/lib/recorder/upload-audio";

/**
 * The real browser and network wiring behind useRecorder, kept separate from
 * the orchestration so the hook stays readable and under the line ceiling.
 *
 * Every one of these is injectable because jsdom has none of them: no
 * MediaRecorder, no getDisplayMedia, no Web Audio, no crypto.randomUUID in
 * older runtimes. The tests pass fakes; nothing here runs under test.
 */
export interface RecorderDeps {
  capture(mode: RecordingMode): ReturnType<typeof startCapture>;
  /** #20: whether this device can share sound at all. False on Android and
   *  iOS, where getDisplayMedia does not exist; Record then skips the choice
   *  and records Mic only. Browsers that expose the API but share no sound
   *  (Firefox, desktop Safari) answer true and are caught by capture's
   *  "no-sound" outcome instead — no user-agent sniffing. */
  canShareSound(): boolean;
  createRecorder(stream: MediaStream, mimeType: string): MediaRecorder;
  isTypeSupported(type: string): boolean;
  newNoteId(): string;
  now(): number;
  getUserId(): Promise<string>;
  bucket(): StorageBucketLike;
  createNote: typeof createRecordedNote;
  /** Tier 1 of the failed-upload reconciliation: the immediate 'failed' write
   *  on a caught Storage error, guarded server-side by the 'uploading'
   *  precondition. Injectable for the same reason as everything else here. */
  markUploadFailed: typeof markUploadFailed;
  /** Retry's first write when the row exists (#24): 'failed' back to
   *  'uploading', guarded server-side on the 'failed' precondition. */
  reopenFailedUpload: typeof reopenFailedUpload;
  /** #12: which IndexedDB backups the server says may go. The rule and the
   *  clock are server-side; see lib/recorder/backup-cleanup.ts. */
  backupsSafeToDiscard: typeof backupsSafeToDiscard;
}

export function browserDeps(): RecorderDeps {
  return {
    capture: (mode) => startCapture(mode),
    canShareSound: () => typeof navigator.mediaDevices?.getDisplayMedia === "function",
    createRecorder: (stream, mimeType) => new MediaRecorder(stream, { mimeType }),
    isTypeSupported: (type) => MediaRecorder.isTypeSupported(type),
    newNoteId: () => crypto.randomUUID(),
    now: () => performance.now(),
    getUserId: async () => {
      const { data } = await createClient().auth.getUser();
      if (!data.user) throw new Error("Cannot record: not signed in.");
      return data.user.id;
    },
    bucket: () =>
      createClient().storage.from(AUDIO_BUCKET) as unknown as StorageBucketLike,
    createNote: createRecordedNote,
    markUploadFailed,
    reopenFailedUpload,
    backupsSafeToDiscard,
  };
}

/** Peak amplitude of the analyser's current buffer, 0..1. */
export function readLevel(analyser: AnalyserNode): number {
  const buffer = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(buffer);
  let peak = 0;
  for (const sample of buffer) peak = Math.max(peak, Math.abs(sample - 128) / 128);
  return peak;
}
